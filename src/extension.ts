import * as vscode from 'vscode';
import * as fs from 'shared/fs';
import * as debug from './debug';
import {DebugProtocol} from '@vscode/debugprotocol';
import {ModuleWebViewProvider} from "./ModulesView";
import {DllEditorProvider} from "./DLLView";
import {HexEditorProvider} from "./HexView";
import {DisassemblyEditorProvider} from "./DisassemblyView";

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
// stub for our hex editor
//-----------------------------------------------------------------------------

interface ViewMemory {
	sessionId: string;
	container: DebugProtocol.Scope;
	variable: DebugProtocol.Variable;
}

function debugViewMemory(params: ViewMemory) {
	const session = debug.Session.get(params.sessionId);
	if (session) {
		const uri = debug.MemoryFileSystem.makeUri(session, params.variable.memoryReference!, undefined, params.variable.name);
		vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true});
	}
}

let hexCommand: vscode.Disposable|undefined;

function hexCommandHandler() {
	if (vscode.workspace.getConfiguration("modules").get<boolean>("useHex"))
		hexCommand	= vscode.commands.registerCommand('workbench.debug.viewlet.action.viewMemory', debugViewMemory);

	return vscode.workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration("modules.useHex")) {
			if (vscode.workspace.getConfiguration("modules").get<boolean>("useHex")) {
				if (!hexCommand)
					hexCommand	= vscode.commands.registerCommand('workbench.debug.viewlet.action.viewMemory', debugViewMemory);
			} else {
				if (hexCommand) {
					hexCommand.dispose();
					hexCommand = undefined;
				}
			}
		}
	});
}

//-----------------------------------------------------------------------------
//	main entry
//-----------------------------------------------------------------------------

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
	const closeTypes = [
		"modules.disassembly",
		"hex.view"
	];
	function mustClose(input: any) {
		const type = input.viewType;
		return typeof type === 'string'
			&& (closeTypes.includes(type.startsWith('mainThreadWebview-') ? type.substring(18) : type));
	}
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups((e: vscode.TabGroupChangeEvent) => {
		const closeTabGroups = vscode.window.tabGroups.all
			.filter(group	=> group.tabs.length && group.tabs.every(tab => mustClose(tab.input)))
			.map(group		=> group.viewColumn);
		context.workspaceState.update('closeTabGroups', closeTabGroups);
	}));
	
	//context.subscriptions.push(telemetry.init(connectionString));

	//override hex editor
	context.subscriptions.push(hexCommandHandler());

	context.subscriptions.push(vscode.commands.registerCommand('modules.sendDAPRequest', debug.sendDAPRequest));

	debug.Session.register(context);

	new ModuleWebViewProvider(context);
	new DllEditorProvider(context);
	new DisassemblyEditorProvider(context);
	
	new fs.ReadOnlyFilesystem(context);
	new fs.SubfileFileSystem(context);
	new debug.MemoryFileSystem(context);

	new debug.SourceProvider(context);

	new HexEditorProvider(context);				
}

export function deactivate() {
	console.log('deactivate');
	hexCommand?.dispose();
}
