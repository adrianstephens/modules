import * as vscode from 'vscode';
import * as fs from 'fs';
import {ModuleWebViewProvider} from "./ModulesView";
import {DllEditorProvider} from "./DLLView";
import {HexEditorProvider} from "./HexView";
import * as telemetry from "./telemetry";

const connectionString = 'InstrumentationKey=a5c3fd08-7ea0-4e3e-880b-6ad15f12e218;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=1b2b09f8-a9d1-47ff-a545-db7b32df8510';

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

function getEncapsulatedUri(uri: vscode.Uri) {
	return uri.with({
		scheme: uri.authority,
		authority: '',
	});
//	return vscode.Uri.parse(uri.fsPath);
}

class ReadOnlyFilesystem implements vscode.FileSystemProvider {
	private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }) {
		return new vscode.Disposable(() => { });
	}

	async stat(uri: vscode.Uri) {
		const stat = await vscode.workspace.fs.stat(getEncapsulatedUri(uri));
		stat.permissions = vscode.FilePermission.Readonly;
		return stat;
	}

	readDirectory(uri: vscode.Uri) { return []; }
	createDirectory(uri: vscode.Uri) {}

	async readFile(uri: vscode.Uri) { return vscode.workspace.fs.readFile(getEncapsulatedUri(uri)); }
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {}
	delete(uri: vscode.Uri, options: { readonly recursive: boolean; }) {}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }) {}
}

export class SubfileFileSystem implements vscode.FileSystemProvider {
	private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

	static make(uri: vscode.Uri, offset:number, length:number) {
		return uri.with({
			scheme: 'subfile',
			authority: uri.scheme,
			fragment: `${offset};${length}`
		});
	}

	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }) {
		return new vscode.Disposable(() => { });
	}

	async stat(uri: vscode.Uri) {
		const parts = uri.fragment.split(';');
		const offset = +parts[0];
		const length = +parts[1];
		const stat = await vscode.workspace.fs.stat(getEncapsulatedUri(uri));
		stat.size = length;
		return stat;
	}

	readDirectory(uri: vscode.Uri) { return []; }
	createDirectory(uri: vscode.Uri) {}

	async readFile(uri: vscode.Uri) {
		const parts = uri.fragment.split(';');
		const offset = +parts[0];
		const length = +parts[1];
		const uri2 = getEncapsulatedUri(uri);
		if (uri2.scheme === 'file') {
			return new Promise<Uint8Array>((resolve, reject) => {
				fs.open(uri.fsPath, 'r', (err, fd) => {
					if (err) {
						reject(err);
						return;
					}

					const buffer = Buffer.alloc(length);
					fs.read(fd, buffer, 0, length, offset, (err, bytesRead, buffer) => {
						if (err) {
							reject(err);
						} else {
							resolve(new Uint8Array(buffer));
						}
						fs.close(fd);
					});
				});
			});
		} else {
			const data = await vscode.workspace.fs.readFile(uri2);
			return data.subarray(offset, offset + length);
		}
	}
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }) {}
	delete(uri: vscode.Uri, options: { readonly recursive: boolean; }) {}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }) {}
}

//-----------------------------------------------------------------------------
//	main entry
//-----------------------------------------------------------------------------

export let bad_reporter: vscode.TelemetryLogger;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(telemetry.init(connectionString));
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('modules-view', new ModuleWebViewProvider(context)));
	context.subscriptions.push(vscode.commands.registerCommand('modules.sendDAPRequest', sendDAPRequest));
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('modules.dllView', new DllEditorProvider(context)));
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('readonly', new ReadOnlyFilesystem, { isCaseSensitive: true }));
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('subfile', new SubfileFileSystem, { isCaseSensitive: true }));

	context.subscriptions.push(vscode.window.registerCustomEditorProvider('hex.view', new HexEditorProvider(context)));
}

export function deactivate() {
	console.log('deactivate');
}
