import * as vscode from 'vscode';
import * as fs from 'shared/src/fs';
import {DebugProtocol} from '@vscode/debugprotocol';
import {ModuleWebViewProvider} from "./ModulesView";
import {DllEditorProvider} from "./DLLView";
import {HexEditorProvider} from "./HexView";

//import * as telemetry from "./telemetry";
//const connectionString = 'InstrumentationKey=a5c3fd08-7ea0-4e3e-880b-6ad15f12e218;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=1b2b09f8-a9d1-47ff-a545-db7b32df8510';

export let extension_context: vscode.ExtensionContext;


export function webviewUri(webview: vscode.Webview, name: string) {
	return webview.asWebviewUri(vscode.Uri.joinPath(extension_context.extensionUri, name));
}

export async function openPreview(uri: vscode.Uri) {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, {
		preview: true,
		viewColumn: vscode.ViewColumn.Active
	});
}

export function getTabGroup(column: number) {
	return vscode.window.tabGroups.all.find(group => group.viewColumn === column);
}

export function getTab(uri: vscode.Uri) {
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === uri.toString())
				return tab;
		}
	}
}


//-----------------------------------------------------------------------------
//	DebugSession(s)
//-----------------------------------------------------------------------------

export const enum State {
	Inactive		= 0,
	Initializing	= 1,
	Stopped			= 2,
	Running			= 3
}

export class DebugSession implements vscode.DebugAdapterTracker {
	static sessions: Record<string, DebugSession> = {};
	private static _onCreate		= new vscode.EventEmitter<DebugSession>();

	static get onCreate()			{ return this._onCreate.event; }
	static get_wrapper(id: string)	{ return this.sessions[id]; }
	static get(id: string)			{ return this.sessions[id]?.session; }
	static get_caps(id: string)		{ return this.sessions[id]?.capabilities; }

	private _onMessage 				= new vscode.EventEmitter<any>();
	private _onDidChangeState		= new vscode.EventEmitter<number>();
	private _onDidInvalidateMemory	= new vscode.EventEmitter<DebugProtocol.MemoryEvent>();
	
	_state: number = State.Inactive;
	capabilities?: DebugProtocol.Capabilities;

	constructor(public session: vscode.DebugSession) {
		DebugSession.sessions[session.id] = this;
		DebugSession._onCreate.fire(this);
	}

	set state(value: number) {
		if (this._state !== value)
			this._onDidChangeState.fire((this._state = value));
	}

	get onMessage()				{ return this._onMessage.event; }
	get onDidChangeState()		{ return this._onDidChangeState.event; }
	get onDidInvalidateMemory() { return this._onDidInvalidateMemory.event; }

	onExit(code: number | undefined, signal: string | undefined) {
		delete DebugSession.sessions[this.session.id];
	}
	onWillStartSession() {
		this.state = State.Initializing;
	}
	onWillStopSession?() {
		this.state = State.Inactive;
	}

	//	onWillReceiveMessage?(message: any): void;

	onDidSendMessage(message: any): void {
		this._onMessage.fire(message);
		
		switch (message.type) {
			case "response":
				switch (message.command) {
					case "initialize":
						this.capabilities = message.body.capabilities;
						break;
				}
				break;

			case "event":
				switch (message.event) {
					case "stopped":
						this.state = State.Stopped;
						break;
					case "continued":
						this.state = State.Running;
						break;
					case "memory":
						this._onDidInvalidateMemory.fire(message as DebugProtocol.MemoryEvent);
						break;
				}
				break;
		}
	}
}

//-----------------------------------------------------------------------------
//	FileSystems
//-----------------------------------------------------------------------------

class DebugMemoryFile implements fs.File {
	constructor(public session: vscode.DebugSession, public memoryReference: string) {}

	public dispose() {}

	public async read(pos: number, length: number): Promise<Uint8Array> {
		const resp = await this.session.customRequest('readMemory', {
			memoryReference: this.memoryReference,
			offset: pos,
			count: length,
		});
		return new Uint8Array(Buffer.from(resp.data, 'base64'));
	}

	public async write(pos: number, data: Uint8Array): Promise<number> {
		const resp = await this.session.customRequest('writeMemory', {
			memoryReference: this.memoryReference,
			offset: pos,
			count: data.length,
			data: Buffer.from(data).toString('base64')
		});
		return resp.bytesWritten;
	}
}

export class DebugMemoryFileSystem extends fs.BaseFileSystem {
	static SCHEME = 'modules-debug-memory';

	static makeUri(session: vscode.DebugSession, memoryReference: string, range?: fs.FileRange, displayName = 'memory') {
		return vscode.Uri.from({
			scheme: this.SCHEME,
			authority: session.id,
			path: `/${encodeURIComponent(memoryReference)}/${encodeURIComponent(displayName)}`,
			query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
		});
	}

	static parseUri(uri: vscode.Uri) {
		const session = DebugSession.get_wrapper(uri.authority);
		if (!session)
			throw 'Debug session not found';

		const rangeMatch		= /range=([0-9]+):([0-9]+)/.exec(uri.query);
		const offset 			= rangeMatch ? { fromOffset: Number(rangeMatch[1]), toOffset: Number(rangeMatch[2]) } : undefined;
		const memoryReference	= decodeURIComponent(uri.path.split('/')[1]);

		return {
			session,
			offset,
			readOnly: DebugSession.get_caps(uri.authority)?.supportsWriteMemoryRequest,
			memoryReference,
		};
	}

	constructor(context: vscode.ExtensionContext) {
		super(context, DebugMemoryFileSystem.SCHEME);
	}

	openFile(uri: vscode.Uri): DebugMemoryFile {
		const { session, memoryReference } = DebugMemoryFileSystem.parseUri(uri);
		return new DebugMemoryFile(session.session, memoryReference);
	}
	
	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }) {
		if (options.recursive)
			return new vscode.Disposable(()=>{});

		const { session, memoryReference, offset } = DebugMemoryFileSystem.parseUri(uri);
		return vscode.Disposable.from(
			session.onDidChangeState(state => {
				if (state === State.Running || state === State.Inactive)
					this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri}]);
			}),
			session.onDidInvalidateMemory(e => {
				if (e.body.memoryReference === memoryReference && (!offset || (e.body.offset < offset.toOffset && e.body.offset + e.body.count >= offset.fromOffset)))
					this._onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri}]);
			})
		);
	}

	stat(uri: vscode.Uri) {
		const { readOnly, offset } = DebugMemoryFileSystem.parseUri(uri);
		return Promise.resolve({
			type: vscode.FileType.File,
			mtime: 0,
			ctime: 0,
			size: offset ? offset.toOffset - offset.fromOffset : 0x10000,
			permissions: readOnly ? vscode.FilePermission.Readonly : undefined,
		});
	}

	async readFile(uri: vscode.Uri) {
		const { session, memoryReference, offset } = DebugMemoryFileSystem.parseUri(uri);
		if (!offset)
			throw `Range must be present to read a file`;

		const file = new DebugMemoryFile(session.session, memoryReference);
		try {
			return await file.read(offset.fromOffset, offset.toOffset - offset.fromOffset);
		} finally {
			file.dispose();
		}
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array) {
		const { session, memoryReference, offset } = DebugMemoryFileSystem.parseUri(uri);
		if (!offset)
			throw `Range must be present to read a file`;

		const file = new DebugMemoryFile(session.session, memoryReference);
		try {
			await file.write(offset.fromOffset, content);
		} finally {
			file.dispose();
		}
	}
}

//-----------------------------------------------------------------------------
//	uri schema
//-----------------------------------------------------------------------------

export class DebugMemory {
	static SCHEME = 'vscode-debug-memory';

	static makeUri(session: vscode.DebugSession, memoryReference: string, range?: fs.FileRange, displayName = 'memory') {
		return vscode.Uri.from({
			scheme: DebugMemory.SCHEME,
			authority: session.id,
			path: `/${encodeURIComponent(memoryReference)}/${encodeURIComponent(displayName)}`,
			query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
		});
	}
}

export class DebugSource implements vscode.TextDocumentContentProvider {
	static SCHEME = 'vscode-debug-source';

	static makeUri(session: vscode.DebugSession, sourceReference: number, displayName = 'memory') {
		return vscode.Uri.from({
			scheme: this.SCHEME,
			authority: session.id,
			path: `/${sourceReference}/${encodeURIComponent(displayName)}`,
		});
	}

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DebugSource.SCHEME, this));
	}

	async provideTextDocumentContent(uri: vscode.Uri) {
		const parts		= uri.path.split('/');
		const sourceReference = +parts[1];
		const session	= DebugSession.get(uri.authority);
		if (session)
			return session.customRequest('source', {sourceReference}).then(resp => resp.content);
	}
}

//-----------------------------------------------------------------------------
//	DAP test
//-----------------------------------------------------------------------------

async function sendDAPRequest() {
	interface DAPRequest {
		command: string;
		args?: any;
	}
	
	function isDAPRequest(x: unknown): x is DAPRequest {
		if (!x || typeof x !== 'object')
			return false;
		const num_keys = Object.keys(x).length;
		return 'command' in x && typeof x.command === 'string' && (num_keys === 1 || num_keys === 2 && 'args' in x);
	}
	
	try {
		const session = vscode.debug.activeDebugSession;
		if (!session)
			throw "There's no active debug session.";

		const editor = vscode.window.activeTextEditor;
		if (!editor)
			throw "Need an editor.";

		const bodyJSON	= editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
		const body 		= JSON.parse(bodyJSON);

		if (!isDAPRequest(body))
			throw `Invalid DAP request. It should be of type: { command: string; args?: any }`;

		const resp = await session.customRequest(body.command, body.args);
		vscode.debug.activeDebugConsole.appendLine('sendDAPRequest:\n' + JSON.stringify(resp, undefined, 2));

	} catch (error: any) {
		vscode.window.showErrorMessage(error.toString());
	}
}

//-----------------------------------------------------------------------------
//	main entry
//-----------------------------------------------------------------------------

interface ViewMemory {
	sessionId: string;
	container: DebugProtocol.Scope;
	variable: DebugProtocol.Variable;
}

export function activate(context: vscode.ExtensionContext) {
	extension_context = context;

	// close unwanted tabgroups
	const closeTabGroups = context.workspaceState.get<number[]>('closeTabGroups', []);
	closeTabGroups.forEach(i => {
		const group = getTabGroup(i);
		if (group)
			vscode.window.tabGroups.close(group);
	});

	// monitor tabgroups
	const closeTypes = new Set([
		"mainThreadWebview-modules.disassembly",
		"mainThreadWebview-hex.view"],
	);
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups((e: vscode.TabGroupChangeEvent) => {
		const closeTabGroups = vscode.window.tabGroups.all.filter(group =>
			group.tabs.length && group.tabs.every(tab => tab.input instanceof vscode.TabInputWebview && closeTypes.has(tab.input.viewType))
		).map(group => group.viewColumn);
		context.workspaceState.update('closeTabGroups', closeTabGroups);
	}));
	
	//context.subscriptions.push(telemetry.init(connectionString));

	//override for debug
	context.subscriptions.push(vscode.commands.registerCommand('workbench.debug.viewlet.action.viewMemory', (params: ViewMemory) => {
		const session = DebugSession.get(params.sessionId);
		if (session) {
			const uri = DebugMemoryFileSystem.makeUri(session, params.variable.memoryReference!, undefined, params.variable.name);
			vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('modules.sendDAPRequest', sendDAPRequest));

	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
		createDebugAdapterTracker: (session: vscode.DebugSession) => new DebugSession(session)
	}));

	new ModuleWebViewProvider(context);
	new DllEditorProvider(context);
	
	new fs.ReadOnlyFilesystem(context);
	new fs.SubfileFileSystem(context);
	new DebugMemoryFileSystem(context);

	new DebugSource(context);

	new HexEditorProvider(context);				
}

export function deactivate() {
	console.log('deactivate');
}
