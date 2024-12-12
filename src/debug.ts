import * as vscode from 'vscode';
import * as fs from 'shared/fs';
import {DebugProtocol} from '@vscode/debugprotocol';

//-----------------------------------------------------------------------------
//	DebugSession(s)
//-----------------------------------------------------------------------------

export const enum State {
	Inactive		= 0,
	Initializing	= 1,
	Stopped			= 2,
	Running			= 3
}

export class Session implements vscode.DebugAdapterTracker {
	static sessions: Record<string, Session> = {};
	private static _onCreate		= new vscode.EventEmitter<Session>();

	static get onCreate()			{ return this._onCreate.event; }
	static get_wrapper(id: string)	{ return this.sessions[id]; }
	static get(id: string)			{ return this.sessions[id]?.session; }
	static get_caps(id: string)		{ return this.sessions[id]?.capabilities; }

	private _onMessage 				= new vscode.EventEmitter<any>();
	private _onDidChangeState		= new vscode.EventEmitter<number>();
	private _onDidInvalidateMemory	= new vscode.EventEmitter<DebugProtocol.MemoryEvent>();
	
	_state: number = State.Inactive;
	capabilities?: DebugProtocol.Capabilities;

	static register(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
			createDebugAdapterTracker: (session: vscode.DebugSession) => new Session(session)
		}));
	}

	constructor(public session: vscode.DebugSession) {
		Session.sessions[session.id] = this;
		Session._onCreate.fire(this);
	}

	set state(value: number) {
		if (this._state !== value)
			this._onDidChangeState.fire((this._state = value));
	}

	get onMessage()				{ return this._onMessage.event; }
	get onDidChangeState()		{ return this._onDidChangeState.event; }
	get onDidInvalidateMemory() { return this._onDidInvalidateMemory.event; }

	onExit(code: number | undefined, signal: string | undefined) {
		delete Session.sessions[this.session.id];
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

class MemoryFile implements fs.File {
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

export class MemoryFileSystem extends fs.BaseFileSystem {
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
		const session = Session.get_wrapper(uri.authority);
		if (!session)
			throw 'Debug session not found';

		const rangeMatch		= /range=([0-9]+):([0-9]+)/.exec(uri.query);
		const offset 			= rangeMatch ? { fromOffset: Number(rangeMatch[1]), toOffset: Number(rangeMatch[2]) } : undefined;
		const memoryReference	= decodeURIComponent(uri.path.split('/')[1]);

		return {
			session,
			offset,
			readOnly: Session.get_caps(uri.authority)?.supportsWriteMemoryRequest,
			memoryReference,
		};
	}

	constructor(context: vscode.ExtensionContext) {
		super(context, MemoryFileSystem.SCHEME);
	}

	openFile(uri: vscode.Uri): MemoryFile {
		const { session, memoryReference } = MemoryFileSystem.parseUri(uri);
		return new MemoryFile(session.session, memoryReference);
	}
	
	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }) {
		if (options.recursive)
			return new vscode.Disposable(()=>{});

		const { session, memoryReference, offset } = MemoryFileSystem.parseUri(uri);
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
		const { readOnly, offset } = MemoryFileSystem.parseUri(uri);
		return Promise.resolve({
			type: vscode.FileType.File,
			mtime: 0,
			ctime: 0,
			size: offset ? offset.toOffset - offset.fromOffset : 0x10000,
			permissions: readOnly ? vscode.FilePermission.Readonly : undefined,
		});
	}

	async readFile(uri: vscode.Uri) {
		const { session, memoryReference, offset } = MemoryFileSystem.parseUri(uri);
		if (!offset)
			throw `Range must be present to read a file`;

		const file = new MemoryFile(session.session, memoryReference);
		try {
			return await file.read(offset.fromOffset, offset.toOffset - offset.fromOffset);
		} finally {
			file.dispose();
		}
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array) {
		const { session, memoryReference, offset } = MemoryFileSystem.parseUri(uri);
		if (!offset)
			throw `Range must be present to read a file`;

		const file = new MemoryFile(session.session, memoryReference);
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

export class MemorySchema {
	static SCHEME = 'vscode-debug-memory';

	static makeUri(session: vscode.DebugSession, memoryReference: string, range?: fs.FileRange, displayName = 'memory') {
		return vscode.Uri.from({
			scheme: MemorySchema.SCHEME,
			authority: session.id,
			path: `/${encodeURIComponent(memoryReference)}/${encodeURIComponent(displayName)}`,
			query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
		});
	}
}

export class SourceProvider implements vscode.TextDocumentContentProvider {
	static SCHEME = 'vscode-debug-source';

	static makeUri(session: vscode.DebugSession, sourceReference: number, displayName = 'memory') {
		return vscode.Uri.from({
			scheme: this.SCHEME,
			authority: session.id,
			path: `/${sourceReference}/${encodeURIComponent(displayName)}`,
		});
	}

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SourceProvider.SCHEME, this));
	}

	async provideTextDocumentContent(uri: vscode.Uri) {
		const parts		= uri.path.split('/');
		const sourceReference = +parts[1];
		const session	= Session.get(uri.authority);
		if (session)
			return session.customRequest('source', {sourceReference}).then(resp => resp.content);
	}
}

//-----------------------------------------------------------------------------
//	DAP test
//-----------------------------------------------------------------------------

export async function sendDAPRequest() {
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
