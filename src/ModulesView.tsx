
import * as vscode from "vscode";
import * as path from "path";
import * as utils from "./modules/utils";
import {DebugProtocol} from '@vscode/debugprotocol';
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

type Module = DebugProtocol.Module & {
	[key: string]: any;
};

function getModuleAddress(session: vscode.DebugSession, frameId: number, m: Module, func: string) {
	return session.customRequest('evaluate', { 
		expression: `((void*(*)(const char*))(${func}))("${m.name}")`,
		frameId,
		context: 	'repl'
	}).then(
		resp => resp.memoryReference,
		error => (console.log(error), undefined)
	);
}


async function getModuleAddressFunction(session: vscode.DebugSession, frameId: number) : Promise<string> {
	let resp = await session.customRequest('evaluate', { 
		expression: 'GetModuleHandleA',
		frameId,
		context: 	'repl'
	});
	if (resp.memoryReference)
		return resp.memoryReference;
	
	resp = await session.customRequest('evaluate', { 
		expression: 'kernel32!GetModuleHandleA',
		frameId,
		context: 	'repl'
	});
	if (resp.memoryReference)
		return resp.memoryReference;

	return '';
}

interface ColumnDescriptor {
	label:		string;
	html?: 		(m: Module)=>string;
}

function columnBoolean(b?: boolean) {
	return <td>{b == undefined ? '?' : b ? 'Yes' : 'No'}</td>;
}
function columnAddress(m: Module, address?: string) {
	return <td id={m.id+'-start'}>{address ?? 'N/A'}</td>;
}

const column_descriptors: Record<string, ColumnDescriptor> = {
	id: 			{label:	'ID'},
	name: 			{label: 'Name'},
	addressRange:  	{label: 'Address',		html:	m => columnAddress(m, m.addressRange)},
	vsLoadAddress: 	{label: "Address",		html:	m => columnAddress(m, m.vsLoadAddress)},
	vsModuleSize: 	{label: "Size"},
	path:   		{label: 'Path',			html:	m => {
		const mod_path = m.path ?? '';
		const directory = path.dirname(mod_path);
		const filename = path.sep + path.basename(mod_path);
		return <td class="path" title={m.path}>
			<span>{directory}</span>
			<span>{filename}</span>
		</td>;
	}},
	vsIs64Bit: 		{label: "64 Bit", 		html: m => columnBoolean(m.vsIs64Bit)},
	isOptimized:   	{label: 'Optimized', 	html: m => columnBoolean(m.isOptimized)},
	isUserCode: 	{label: 'User Code', 	html: m => columnBoolean(m.isUserCode)},
	version:    	{label: 'Version'},
	symbolFilePath:	{label: 'Symbols',		html: m => <td>{m.symbolFilePath ?? m.symbolStatus}</td>},
	dateTimeStamp: 	{label: 'Time Stamp'},
	vsTimestampUTC: {label: 'Time Stamp'},
	//	vsPreferredLoadAddress: "4324950016",
	//	vsLoadOrder: 1,
};

const DEBUG_MEMORY_SCHEME = 'vscode-debug-memory';
const getUriForDebugMemory = (
	sessionId: string,
	memoryReference: string,
	range?: { fromOffset: number; toOffset: number },
	displayName = 'memory'
) => {
	return vscode.Uri.from({
		scheme: DEBUG_MEMORY_SCHEME,
		authority: sessionId,
		path: '/' + encodeURIComponent(memoryReference) + `/${encodeURIComponent(displayName)}.bin`,
		query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
	});
};

function by_id(id: string | number) {
	if (typeof id === 'number')
		return `[id="${id}"]`;

	id = id.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
	return id[0] >= '0' && id[0] <= '9' ? `[id="${id}"]` : `#${id}`;
}

export class ModuleWebViewProvider implements vscode.WebviewViewProvider, vscode.DebugAdapterTracker {
	private view?: vscode.WebviewView;
	private receive?: vscode.Disposable;
	private update	= new utils.CallCombiner(async () => {
		if (this.view)
			this.view.webview.html = this.updateView(Object.values(this.modules));
	}, 100);

	modules: Record<string, Module> = {};
	address_function	= '';
	address_requested	= new Set<Module>();
	selected?: Module;

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
	private addClass(selector: string, clss: string, enable:boolean) {
		this.view?.webview.postMessage({command: 'add_class', selector, class: clss, enable});
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

		this.receive = webviewView.webview.onDidReceiveMessage(async message => {
			switch (message.command) {
				case 'select': {
					const m = this.modules[message.id];
					if (m !== this.selected) {
						if (this.selected)
							this.addClass(by_id(this.selected.id), 'selected', false);
						this.selected = m;
						this.addClass(by_id(m.id), 'selected', true);
					}
					break;
				}
				case 'click': {
					const m = this.modules[message.id];
					const session = vscode.debug.activeDebugSession;
					if (session && m.addressRange) {
						//vscode.commands.executeCommand('workbench.debug.viewlet.action.viewMemory', m.addressRange);
						const uri = getUriForDebugMemory(session.id, m.addressRange, undefined, m.name);
						await vscode.commands.executeCommand('vscode.openWith', uri, 'hexEditor.hexedit');
					}
					break;
				}
			}
		});

		this.update.trigger();
	}

	onWillStopSession(): void {
		this.selected			= undefined;
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
					if (session && (session.type === 'cppvsdbg' || session.type === 'cppdbg'))
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

		if (!has_col.has('addressRange') && !has_col.has('vsLoadAddress'))
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
						<tr id={m.id}>{cols.map(i => column_descriptors[i].html ? column_descriptors[i].html(m) : <td>{m[i]}</td>)}</tr>
					)}
				</table>
				<script src={this.getUri("modules.js")}></script>
			</body></html>;
	}
}
