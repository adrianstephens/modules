
import * as vscode from "vscode";
import * as path from "path";
import * as utils from "./modules/utils";
import {DebugProtocol} from '@vscode/debugprotocol';
import {jsx, fragment, codicons} from "./modules/jsx";
import * as telemetry from "./telemetry";
import {bad_reporter} from "./extension";

//-----------------------------------------------------------------------------
//	ModuleViewProvider
//-----------------------------------------------------------------------------

type Module = DebugProtocol.Module & {
	[key: string]: any;
};

interface ColumnDescriptor {
	label:		string;
	type?:		'string' | 'number' | 'boolean' | 'time' | 'path';
	html?: 		(m: Module)=>string;
}

function descriptorBoolean(label: string, id: string) : ColumnDescriptor {
	return {label, type: 'boolean', html: m => <td>{m[id] == undefined ? '?' : m[id] ? 'Yes' : 'No'}</td>};
}
function descriptorAddress(label: string, id: string) : ColumnDescriptor {
	return {label, type: 'number', html: m => <td id={m.id+'-start'}>{m[id] ?? 'N/A'}</td>};
}
function descriptorPath(label: string, id: string) : ColumnDescriptor {
	return {label, type: 'path', html: m => {
		const filename = m[id] ?? '';
		return <td class="path" title={filename}>
			<span>{path.dirname(filename)}</span>
			<span>{path.sep + path.basename(filename)}</span>
		</td>;
	}};
}


const column_descriptors: Record<string, ColumnDescriptor> = {
//	id: 			{label:	'ID', 		type: 'number'},
	vsLoadOrder:	{label: 'Order',		type: 'number'},
	name: 			{label: 'Name',								html: m => <td>{path.basename(m.name)}</td>},
	addressRange:  	descriptorAddress('Address', 'addressRange'),
	vsLoadAddress: 	descriptorAddress("Address", 'vsLoadAddress'),
	vsModuleSize: 	{label: "Size",			type: 'number'},
	path:   		descriptorPath('Path', 'path'),
	vsIs64Bit: 		descriptorBoolean("64 Bit", 'vsIs64Bit'),
	isOptimized:   	descriptorBoolean('Optimized', 'isOptimized'),
	isUserCode: 	descriptorBoolean('User Code', 'isUserCode'),
	version:		{label: 'Version'},
	symbolFilePath:	{label: 'Symbols',							html: m => <td>{m.symbolFilePath ?? m.symbolStatus}</td>},
	dateTimeStamp: 	{label: 'Time Stamp',	type: 'time'},
	vsTimestampUTC: {label: 'Time Stamp',	type: 'time',		html: m => <td>{new Date(m.vsTimestampUTC * 1000).toUTCString()}</td>},
	//	vsPreferredLoadAddress: "4324950016",
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
		path: '/' + encodeURIComponent(memoryReference) + `/${encodeURIComponent(displayName)}`,
		query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
	});
};

const DEBUG_SOURCE_SCHEME = 'vscode-debug-source';
const getUriForDebugSource = (
	sessionId: string,
	sourceReference: number,
	displayName: string
) => {
	return vscode.Uri.from({
		scheme: DEBUG_SOURCE_SCHEME,
		authority: sessionId,
		path: '/' + sourceReference.toString() + '/' + displayName,
	});
};

class DebugSourceTextProvider implements vscode.TextDocumentContentProvider {
	async provideTextDocumentContent(uri: vscode.Uri) {
		const sessionId = uri.authority;
		const parts = uri.path.split('/');
		const sourceReference = +parts[1];
		if (vscode.debug.activeDebugSession?.id === sessionId) {
			const resp = await vscode.debug.activeDebugSession.customRequest('source', {sourceReference});
			return resp.content;
		}
	}
}

async function openPreview(uri: vscode.Uri) {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, {
		preview: true,
		viewColumn: vscode.ViewColumn.Active
	});
}


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
			this.view.webview.html = this.updateView();
	}, 100);
	private tele    = new utils.CallCombiner0;

	modules: Record<string, Module> = {};
	address_function	= '';
	address_requested	= new Set<Module>();
	nextOrder			= 0;
	selected_id?: string;

	constructor(private context: vscode.ExtensionContext) {
		const me = this;
		vscode.debug.registerDebugAdapterTrackerFactory('*', {
			createDebugAdapterTracker(session: vscode.DebugSession) {
				return me;
			}
		});
		vscode.workspace.registerTextDocumentContentProvider(DEBUG_SOURCE_SCHEME, new DebugSourceTextProvider);
	}

	dispose() {
		this.receive?.dispose();
	}
		
	private setText(id: string, value:any) {
		this.view?.webview.postMessage({command: 'set_text', id, value});
	}
	private addClass(selector: string, clss: string, enable:boolean) {
		this.view?.webview.postMessage({command: 'add_class', selector, class: clss, enable});
	}

	private async fixModuleAddresses(session: vscode.DebugSession) {
		const filtered = Object.values(this.modules).filter(m => !m.addressRange && !m.vsLoadAddress && !this.address_requested.has(m));
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
					if (message.id !== this.selected_id) {
						if (this.selected_id)
							this.addClass(by_id(this.selected_id), 'selected', false);
						this.selected_id = message.id;
						this.addClass(by_id(message.id), 'selected', true);
					}
					break;
				}
				case 'click': {
					const m = this.modules[message.id];
					const session = vscode.debug.activeDebugSession;
					if (session && m.addressRange) {
						//vscode.commands.executeCommand('workbench.debug.viewlet.action.viewMemory', m.addressRange);
						const uri = getUriForDebugMemory(session.id, m.addressRange, undefined, m.name);
						await vscode.commands.executeCommand('vscode.openWith', uri, 'hexEditor.hexedit', {preview: true});
					} else if (session && m.sourceReference) {
						openPreview(getUriForDebugSource(session.id, m.sourceReference, path.extname(m.name) ? m.name : m.name + '.js'));
					} else if (m.path) {
						openPreview(vscode.Uri.file(m.path));
					}
					break;
				}
				case 'open': {
                    console.log(message);
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
                    break;
                }

			}
		});

		this.update.trigger();
	}

	onWillStopSession(): void {
		this.nextOrder			= 0;
		this.selected_id		= undefined;
		this.address_requested.clear();
		this.address_function	= '';
		this.modules			= {};
		this.update.trigger();
	}

	onDidSendMessage(message: any): void {
		if (message.type === 'response') {
			switch (message.command) {
				case 'modules':
					this.modules = message.body.modules;
					this.update.trigger();
					break;

				case 'stackTrace':
					//cppvsdbg doesn't return module addresses, so we do it by evaluating GetModuleHandleA
					//other debuggers might need their own hacks
					if (vscode.debug.activeDebugSession?.type === 'cppvsdbg')
						this.fixModuleAddresses(vscode.debug.activeDebugSession);
					break;
			}
		}

		if (message.type === 'event') {
			switch (message.event) {
				case 'module': {
					const module = message.body.module;
					switch (message.body.reason) {
						case 'new':
							this.modules[module.id] = {vsLoadOrder: this.nextOrder++, ...module};
							break;
						case 'changed':
							this.modules[module.id] = {vsLoadOrder: this.modules[module.id], ...module};
							break;
						case 'removed':
							delete this.modules[module.id];
							break;
					}
					this.update.trigger();
					break;
				}
				case 'loadedSource': {
					const source = message.body.source;
					const id = source.sourceReference || source.path;
					switch (message.body.reason) {
						case 'new':
							this.modules[id] = {vsLoadOrder: this.nextOrder++, ...source};
							break;
						case 'changed':
							this.modules[id] = {vsLoadOrder: this.modules[id].vsLoadOrder, ...source};
							break;
						case 'removed':
							delete this.modules[id];
							break;
					}
					this.update.trigger();
					break;
				}
			}
		}
	}

	getUri(name: string) {
		return  this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', name));
	}

	updateView() : string {
		const	modules = Object.values(this.modules);
		if (modules.length == 0) {
			const type = vscode.debug.activeDebugSession?.type;
			if (type)
				telemetry.send('view.none', {type});

			return `<!DOCTYPE html>`+
			<html lang="en">
				<body>
					No Modules
				</body>
			</html>;
		}

		const has_col	= modules.reduce((cols, m) => (Object.keys(m).forEach(k => cols.add(k)), cols), new Set<string>());

        this.tele.combine(1000, () => telemetry.send('view.update', {type: vscode.debug.activeDebugSession?.type || 'unknown', cols: Array.from(has_col.keys()).join(', '), rows: modules.length}));

		if (has_col.has('vsLoadAddress')) {
			has_col.delete('vsLoadAddress');
			Object.values(modules).forEach(m => {
				const address = parseInt(m.vsLoadAddress ?? '');
				if (!isNaN(address)) {
					m.addressRange = '0x' + address.toString(16);
					delete m.vsLoadAddress;
				}
			});
		}
		if (!has_col.has('addressRange'))
			has_col.add('addressRange');

		const cols		= Object.keys(column_descriptors).filter(k => has_col.has(k));

		return '<!DOCTYPE html>' +
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={this.getUri('modules.css')}/>
					<title>Modules</title>
				</head>
				<body>
				<table>
					<thead>
						<tr>
							{cols.map(i => 
								<th data-type={column_descriptors[i].type}>{column_descriptors[i].label}</th>
							).join('')}
						</tr>
					</thead>

					<tbody>
						{Object.entries(this.modules).map(([id, m]) =>
							<tr id={id}>{cols.map(i => column_descriptors[i].html ? column_descriptors[i].html(m) : <td>{m[i]}</td>)}</tr>
						)}
					</tbody>
				</table>
				<script src={this.getUri("modules.js")}></script>
			</body></html>;
	}
}
