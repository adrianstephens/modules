if (process.env.NODE_ENV === 'development')
	import('source-map-support').then(sms => sms.install());

//import 'source-map-support/register';
import * as vscode from 'vscode';
import {ModuleWebViewProvider} from "./ModulesView";

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

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('modules-view', new ModuleWebViewProvider(context)));
	context.subscriptions.push(vscode.commands.registerCommand('modules.sendDAPRequest', sendDAPRequest));
}
