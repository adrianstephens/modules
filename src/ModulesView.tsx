
import * as vscode from "vscode";
import * as path from "path";
import * as utils from "./modules/utils";
import {DebugProtocol} from 'vscode-debugprotocol';
import {jsx, fragment, codicons} from "./modules/jsx";

//-----------------------------------------------------------------------------
//	ModuleViewProvider
//-----------------------------------------------------------------------------

function tableRow(row: any[], func:(i:any)=>string) {
	return <tr>
		{row.map(i => <td>{func(i)}</td>).join('')}
	</tr>;
}

function tableHead(heads: any[], func:(i:any)=>string) {
	return <thead>
		<tr>
			{heads.map(i => func(i)).join('')}
		</tr>
	</thead>;
}
function tableBody(entries: any[], func:(i:any)=>string) {
	return <tbody>
		{entries.map(i => func(i)).join('')}
	</tbody>;
}

type Module = DebugProtocol.Module;

function getModuleAddress(session: vscode.DebugSession, frameId: number, m: Module, func: string) {
	return session.customRequest('evaluate', { 
		expression: `((void*(*)(const char*))(${func}))("${m.name}")`,
		frameId,
		context: 	'watch'
	}).then(
		resp => resp.memoryReference,
		error => (console.log(error), undefined)
	);
}


async function getModuleAddressFunction(session: vscode.DebugSession, frameId: number) {
	let resp = await session.customRequest('evaluate', { 
		expression: 'GetModuleHandleA',
		frameId,
		context: 	'watch'
	});
	if (resp.memoryReference)
		return resp.memoryReference;
	resp = await session.customRequest('evaluate', { 
		expression: 'kernel32!GetModuleHandleA',
		frameId,
		context: 	'watch'
	});
	if (resp.memoryReference)
		return resp.memoryReference;
}

interface ColumnDescriptor {
	label:		string;
	html?: 		(m: Module)=>string;
}

function columnBoolean(b?: boolean) {
	return <td>{b == undefined ? '?' : b ? 'Yes' : 'No'}</td>;
}

const column_descriptors: Record<string, ColumnDescriptor> = {
	id: 			{label:	'ID'},
	name: 			{label: 'Name'},
	addressRange:  	{label: 'Address',	html:	m => <td id={m.id+'-start'}>{m.addressRange ?? 'N/A'}</td>},
	path:   		{label: 'Path',		html:	m => {
		const mod_path = m.path ?? '';
		const directory = path.dirname(mod_path);
		const filename = path.sep + path.basename(mod_path);
		return <td class="path-cell" title={m.path}>
			<span class="path-dir">{directory}</span>
			<span class="path-filename">{filename}</span>
		</td>;
	}},
	isOptimized:   	{label: 'Optimized', 	html: m => columnBoolean(m.isOptimized)},
	isUserCode: 	{label: 'User Code', 	html: m => columnBoolean(m.isUserCode)},
	version:    	{label: 'Version'},
	symbolFilePath:	{label: 'Symbols',		html: m => <td>{m.symbolFilePath ?? m.symbolStatus}</td>},
	dateTimeStamp: 	{label: 'Time Stamp'},
};

export class ModuleWebViewProvider implements vscode.WebviewViewProvider, vscode.DebugAdapterTracker {
	private view?: vscode.WebviewView;
	private update	= new utils.CallCombiner(async () => {
		if (this.view)
			this.view.webview.html = this.updateView(Object.values(this.modules));
	}, 100);

	modules: Record<string, Module> = {};
	address_function	= '';
	address_requested	= new Set<Module>();

	constructor(private context: vscode.ExtensionContext) {
		const me = this;
		vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker(session: vscode.DebugSession) {
                return me;
            }
        });
	}
		
	private setText(id: string, value:any) {
		this.view?.webview.postMessage({command: 'set_text', id, value});
	}

	private async fixModuleAddresses(session: vscode.DebugSession) {
		const filtered = Object.values(this.modules).filter(m => !m.addressRange && !this.address_requested.has(m));
		if (filtered.length) {
			if (!this.address_function)
				this.address_function = await getModuleAddressFunction(session, 1000);

			utils.asyncMap(filtered, async m => {
				this.address_requested.add(m);
				m.addressRange = await getModuleAddress(session, 1000, m, this.address_function);
				if (m.addressRange)
					this.setText(m.id+'-start', m.addressRange);
			});
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Promise<void> {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'assets')]
		};
		this.update.trigger();
	}

	onWillStopSession(): void {
		this.address_requested.clear();
		this.address_function	= '';
		this.modules			= {};
		this.update.trigger();
	}

	onDidSendMessage(message: any): void {
		const session = vscode.debug.activeDebugSession;

		if (message.type === 'response') {
			switch (message.command) {
				case 'modules':
					this.modules = message.body.modules;
					this.update.trigger();
					break;

				case 'stackTrace':
					//cppvsdbg doesn't return module addresses, so we do it by evaluating GetModuleHandleA
					//other debuggers might need their own hacks
					if (session && session.type === 'cppvsdbg')
						this.fixModuleAddresses(session);
					break;
			}
		}

		if (message.type === 'event') {
			switch (message.event) {
				case 'module':
					switch (message.body.reason) {
						case 'new':
							this.modules[message.body.module.id] = message.body.module;
							break;
							
						case 'changed':
							this.modules[message.body.module.id] = message.body.module;
							break;

						case 'removed':
							delete this.modules[message.body.module.id];
							break;
					}
					this.update.trigger();
					break;
			}
		}
	}

	getUri(name: string) {
		return  this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', name));
	}

	updateView(modules: Module[]) : string {
		if (modules.length == 0)
			return `<!DOCTYPE html>`+
			<html lang="en">
				<body>
					No Modules
				</body>
			</html>;

		const has_col	= modules.reduce((cols, m) => (Object.keys(m).forEach(k => cols.add(k)), cols), new Set<string>());
		has_col.add('addressRange');
		const cols		= Object.keys(column_descriptors).filter(k => has_col.has(k));

		return `<!DOCTYPE html>`+
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={this.getUri('modules.css')}/>
					<title>Modules</title>
				</head>
				<body>
				<table>
					{tableHead(cols, i => <th class={i==='id' ? 'sort' : undefined}>{column_descriptors[i].label}</th>)}
					{tableBody(modules, m =>
						<tr>{cols.map(i => column_descriptors[i].html ? column_descriptors[i].html(m) : <td>{m[i]}</td>)}</tr>
					)}
				</table>
				<script src={this.getUri("modules.js")}></script>
			</body></html>;
	}
}
