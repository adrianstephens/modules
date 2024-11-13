import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as utils from './shared/utils';
import {DebugProtocol} from '@vscode/debugprotocol';
import {ModuleWebViewProvider} from "./ModulesView";
import {DllEditorProvider, DyLibEditorProvider} from "./DLLView";
import {HexEditorProvider} from "./HexView";
import * as telemetry from "./telemetry";
import "./shared/clr";
//import * as zlib from "zlib";

const connectionString = 'InstrumentationKey=a5c3fd08-7ea0-4e3e-880b-6ad15f12e218;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=1b2b09f8-a9d1-47ff-a545-db7b32df8510';

export function webviewUri(context: vscode.ExtensionContext, webview: vscode.Webview, name: string) {
	return webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "assets", name));
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

export interface FileRange { fromOffset: number; toOffset: number; }

export interface File {
	dispose(): void;
	read(pos: number, length: number): Promise<Uint8Array>;
	write(pos: number, data: Uint8Array): Promise<number>;
}

export function isFile(obj: any): obj is File {
	return obj && typeof obj.dispose === 'function' && typeof obj.read === 'function' && typeof obj.write === 'function';
}

interface FileSystem extends vscode.FileSystemProvider {
	openFile(uri: vscode.Uri): File | Promise<File>;
}
const filesystems: Record<string,FileSystem> = {};

abstract class BaseFileSystem implements FileSystem {
	protected _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    constructor(context: vscode.ExtensionContext, scheme: string) {
        filesystems[scheme] = this;
		context.subscriptions.push(vscode.workspace.registerFileSystemProvider(scheme, this, { isCaseSensitive: true }));
    }

    // Abstract method that must be implemented
    abstract openFile(uri: vscode.Uri): File | Promise<File>;
    abstract readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array>;

	//stubs
	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable { throw 'not implemented'; }
	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> { throw 'not implemented'; }
	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] { throw 'not implemented'; }
	createDirectory(uri: vscode.Uri)  { throw 'not implemented'; }
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; })  { throw 'not implemented'; }
	delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void  { throw 'not implemented'; }
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; })  { throw 'not implemented'; }
}

export function withOffset(file: File, offset: FileRange) {
	return new class implements File {
		length = offset.toOffset - offset.fromOffset;
		dispose() { file.dispose(); }
		read(pos: number, length: number) {
			const start = pos + offset.fromOffset;
			const end	= Math.min(start + length, offset.toOffset);
			return file.read(start, end - start);
		}
		write(pos: number, data: Uint8Array) {
			const start = pos + offset.fromOffset;
			const end	= Math.min(start + data.length, offset.toOffset);
			return file.write(start, data.subarray(0, end - start));
		}
	};
}

export function openFile(uri: vscode.Uri) {
	switch (uri.scheme) {
		case 'file':
			return NormalFile.open(uri);
		default:
			return filesystems[uri.scheme]?.openFile(uri);
	}
}

export class NormalFile implements File {
	constructor(public fd:number) {}

	static open(uri: vscode.Uri) {
		return new Promise<NormalFile>((resolve, reject) => {
			fs.open(uri.fsPath, 'r', (err, fd) => {
				if (err)
					reject(err);
				else
					resolve(new NormalFile(fd));
			});
		});
	}
	dispose()	{
		fs.close(this.fd);
	}
	read(pos: number, length: number) {
		return new Promise<Uint8Array>((resolve, reject) => {
			const buffer = Buffer.alloc(length);
			fs.read(this.fd, buffer, 0, length, pos, (err, bytesRead, buffer) => {
				if (err)
					reject(err);
				else
					resolve(new Uint8Array(buffer));
			});
		});
	}
	write(pos: number, data: Uint8Array): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			fs.write(this.fd, data, 0, data.length, pos, (err, bytesWritten) => {
				if (err)
					reject(err);
				else
					resolve(bytesWritten);
			});
		});
	}
}


function getEncapsulatedUri(uri: vscode.Uri) {
	return uri.with({
		scheme: uri.authority,
		authority: '',
	});
//	return vscode.Uri.parse(uri.fsPath);
}

class ReadOnlyFilesystem extends BaseFileSystem {
	static SCHEME = 'readonly';

	constructor(context: vscode.ExtensionContext) {
		super(context, ReadOnlyFilesystem.SCHEME);
	}

	stat(uri: vscode.Uri) {
		return vscode.workspace.fs.stat(getEncapsulatedUri(uri)).then(stat => {stat.permissions = vscode.FilePermission.Readonly; return stat; });
	}

	openFile(uri: vscode.Uri) {
		return NormalFile.open(getEncapsulatedUri(uri));
	}
	readFile(uri: vscode.Uri) {
		return vscode.workspace.fs.readFile(getEncapsulatedUri(uri));
	}
}

export class SubfileFileSystem extends BaseFileSystem {
	static SCHEME = 'subfile';

	static makeUri(uri: vscode.Uri, offset:number, length:number) {
		return uri.with({
			scheme: 'subfile',
			authority: uri.scheme,
			fragment: `${offset};${offset + length}`
		});
	}
	static parseUri(uri: vscode.Uri) {
		const parts = uri.fragment.split(';');
		return {
			uri:	getEncapsulatedUri(uri),
			offset: {fromOffset: +parts[0], toOffset: +parts[1]}
		};
	}
	
	constructor(context: vscode.ExtensionContext) {
		super(context, SubfileFileSystem.SCHEME);
	}

	stat(uri: vscode.Uri) {
		const { uri: uri2, offset } = SubfileFileSystem.parseUri(uri);
		return vscode.workspace.fs.stat(uri2).then(stat => {
			stat.size	= offset.toOffset - offset.fromOffset;
			return stat;
		});
	}

	async readFile(uri: vscode.Uri) {
		const { uri: uri2, offset } = SubfileFileSystem.parseUri(uri);
		if (uri2.scheme === 'file') {
			const file = await NormalFile.open(uri2);
			try {
				return file.read(offset.fromOffset, offset.toOffset - offset.fromOffset);
			} finally {
				file.dispose();
			}
		} else {
			const data = await vscode.workspace.fs.readFile(uri2);
			return data.subarray(offset.fromOffset, offset.toOffset);
		}
	}
	async openFile(uri: vscode.Uri) {
		const { uri: uri2, offset } = SubfileFileSystem.parseUri(uri);
		const file = await openFile(uri2);
		return withOffset(file, offset);
	}
}

class DebugMemoryFile implements File {
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

export class DebugMemoryFileSystem extends BaseFileSystem {
	static SCHEME = 'modules-debug-memory';

	static makeUri(session: vscode.DebugSession, memoryReference: string, range?: FileRange, displayName = 'memory') {
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

	static makeUri(session: vscode.DebugSession, memoryReference: string, range?: FileRange, displayName = 'memory') {
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
	
	context.subscriptions.push(telemetry.init(connectionString));

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
	new DyLibEditorProvider(context);
	
	new ReadOnlyFilesystem(context);
	new SubfileFileSystem(context);
	new DebugMemoryFileSystem(context);

	new DebugSource(context);

	new HexEditorProvider(context);				
}

export function deactivate() {
	console.log('deactivate');
}
