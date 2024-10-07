import 'source-map-support/register';
import * as vscode from 'vscode';
import {ModuleWebViewProvider} from "./ModulesView";

//-----------------------------------------------------------------------------
//	DAP test
//-----------------------------------------------------------------------------

function sendDAPRequest() {
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
	
	function tryParseJSON(s: string) {
		try {
			return JSON.parse(s);
		} catch {
			return undefined;
		}
	}

	const session = vscode.debug.activeDebugSession;
	if (!session) {
		vscode.window.showErrorMessage("There's no active debug session.");
		return;
	}

	const editor = vscode.window.activeTextEditor;
	if (!editor)
		return;

	const bodyJSON	= editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
	const body 		= tryParseJSON(bodyJSON);

	if (!isDAPRequest(body)) {
		vscode.window.showErrorMessage(`Invalid DAP request. It should be of type: { command: string; args?: any }`);
		return;
	}
	session.customRequest(body.command, body.args).then(
		resp	=> vscode.debug.activeDebugConsole.appendLine(JSON.stringify(resp, undefined, 2)),
		error	=> vscode.window.showErrorMessage(error)
	);
}

//-----------------------------------------------------------------------------
//	main entry
//-----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('modules-view', new ModuleWebViewProvider(context)));
	context.subscriptions.push(vscode.commands.registerCommand('modules.sendDAPRequest', sendDAPRequest));
}
