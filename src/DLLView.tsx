import * as vscode from 'vscode';
import * as path from 'path';
import {DebugProtocol} from '@vscode/debugprotocol';
import {jsx, fragment, render, codicons, Icon} from "./shared/jsx";
import * as main from "./extension";
import * as utils from "./shared/utils";
import * as pe from "./shared/pe";
import * as mach from "./shared/mach"
import * as elf from "./shared/elf"
import {DisassemblyView} from "./DisassemblyView";

type IconType0	= string | vscode.Uri;
type IconType	= IconType0 | vscode.ThemeIcon | {
	light:	IconType0;
	dark:	IconType0;
};

const folder = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
const section = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));

const icon_group = new vscode.ThemeIcon('circleLargeFilled', new vscode.ThemeColor('charts.blue'));
const icon_binary = new vscode.ThemeIcon('fileBinary', new vscode.ThemeColor('charts.green'));
//const icon_number = new vscode.ThemeIcon('symbolNumber', new vscode.ThemeColor('charts.red'));
//const icon_number = new vscode.ThemeIcon('circleSmallFilled', new vscode.ThemeColor('charts.red'));
const icon_item = 'circleSmallFilled';


function getIcon0(icon: IconType0) {
	return typeof icon === 'string'
		? <Icon code={codicons[icon]}/>
		: <span class="codicon" style={`background-image: url(${icon});`}/>;
}

function Icon2(props: {icon: IconType}) {
	const icon = props.icon;
	if (typeof icon === 'string' || icon instanceof vscode.Uri)
		return getIcon0(icon);

	if (icon instanceof vscode.ThemeIcon) {
		if (icon.color) {
			const color = (icon.color as any).id;
			return <Icon code={codicons[icon.id]} color={`var(--vscode-${color.replace('.', '-')})`}/>;
		}
		return <Icon code={codicons[icon.id]}/>;
	}

	return getIcon0(vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
		? icon.light
		: icon.dark
	);
}

function TreeParent(props: {name: string, icon?: IconType, open?: boolean, path?: boolean, children?: any}) {
	return <div class={'caret' + (props.open ? ' caret-down' : '') + (props.path ? ' path' : '')}>
		<span>
			{props.icon && <Icon2 icon={props.icon}/>}
			{props.name}
		</span>
		<div class="children">
			{props.children}
		</div>
	</div>;
}

function hasCustomToString(value: any): boolean {
    return value && value.toString !== Object.prototype.toString;
}

function Flag(flags: number, mask: number, on: string, off = '-') {
	return (flags & mask) ? on : off;
}
function MemoryFlags(flags: number) {
	return Flag(flags, utils.MEM.WRITE, 'w') + Flag(flags, utils.MEM.EXECUTE, 'x') + Flag(flags, utils.MEM.READ, 'r');
}

function TreeItem(props: {name: string, value: any}) {
	const {name, value} = props;
	switch (typeof value) {
		case 'undefined':
			return;

		case 'object':
			if (value instanceof utils.MappedMemory) {
				return <div class='binary' data-offset={value.data.byteOffset} data-length={value.data.byteLength} data-va={value.address} data-exec={!!(value.flags & utils.MEM.EXECUTE)}>
					<Icon2 icon={icon_binary}/>
					{`${name}: 0x${value.address.toString(16)}[0x${value.data!.byteLength.toString(16)}] ${MemoryFlags(value.flags)}`}
				</div>;
			} else if (value instanceof Uint8Array) {
				return <div class='binary' data-offset={value.byteOffset} data-length={value.length}>
					<Icon2 icon={icon_binary}/>
					{`${name}: 0x${value.byteOffset.toString(16)}[${value.length}]`}
				</div>;
			} else if (!(0 in value) && hasCustomToString(value)) {
				return <div>
					<Icon2 icon={icon_item}/>
					{`${name}: ${value}`}
				</div>;
			} else {
				return <TreeParent name={props.name} path={value instanceof pe.DLLImports}>
					{Object.entries(value).map(([name, value]) => <TreeItem name={name} value={value}/> )}
				</TreeParent>
			}
		//case 'number':
		//case 'bigint':
		//	return <div><Icon2 icon={icon_number}/>{`${name}: ${value}`}</div>;

		default:
			//console.log(name, value);
			return <div><Icon2 icon={icon_item}/> {`${name}: ${value}`}</div>;
	}
}

function TreeChildren(children: Record<string,any>) {
	return Object.entries(children).map(([name, value]) => <TreeItem name={name} value={value}/>);
}

async function findModule(name: string) {
	const session = vscode.debug.activeDebugSession;
	if (session) {
		const modules = await vscode.commands.executeCommand("modules.getModules") as DebugProtocol.Module[];
		name = name.toLowerCase();
		for (const i of modules) {
			if (i.path && path.parse(i.path).name.toLowerCase() === name)
				return i;
		}
	}
}

async function OnMessage(context: vscode.ExtensionContext, uri: vscode.Uri, message: any) {
	switch (message.command) {
		case 'binary': {
			const length	= +message.length;
			const module	= await findModule(path.parse(uri.path).name);
			if (module) {
				const session = vscode.debug.activeDebugSession!;
				const address = +(module.addressRange ?? 0) + +message.offset;
				if ('exec' in message && await DisassemblyView.canDisassemble(session, address)) {
					new DisassemblyView(context, session, address, length, `Disassembly @ 0x${address.toString(16)}`, vscode.ViewColumn.Beside);
				} else {
					const uri = main.DebugMemoryFileSystem.makeUri(session, `0x${address.toString(16)}`, {fromOffset: 0, toOffset: length});
					vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true, viewColumn: vscode.ViewColumn.Beside});
				}
				return;
			}
	
			const offset	= +message.offset;
			const file		= main.withOffset(await main.NormalFile.open(uri), {fromOffset: offset, toOffset: offset + length});
			vscode.commands.executeCommand('hex.open', file, message.name ?? "binary", vscode.ViewColumn.Beside);
			
			//const uri = dll.uri.with({query: `baseAddress=${offset}`})
			//vscode.commands.executeCommand('vscode.openWith', uri, 'hexEditor.hexedit', {preview: true, viewColumn: vscode.ViewColumn.Beside});
			//const uri = main.SubfileFileSystem.makeUri(dll.uri, offset, length);
			//vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true, viewColumn: vscode.ViewColumn.Beside});
			break;
		}
		case 'path': {
			console.log(message.path);
			const module	= await findModule(message.path);
			if (module)
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(module.path!));
			break;
		}

	}
}

//-----------------------------------------------------------------------------
//	PORTABLE EXECUTABLE
//-----------------------------------------------------------------------------

class DLLDocument extends pe.PE implements vscode.CustomDocument {
	constructor(readonly uri: vscode.Uri, data: Uint8Array) {
		super(data);
	}

	dispose() {}
}

export class DllEditorProvider implements vscode.CustomReadonlyEditorProvider {
	private receive?: vscode.Disposable;

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.window.registerCustomEditorProvider('modules.dllView', this));
	}

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		const data = await vscode.workspace.fs.readFile(uri).then(
			data => data,
			err => {
				vscode.window.showErrorMessage(err.message);
				throw err;
			}
		);
		return new DLLDocument(uri, data);
	}

	async resolveCustomEditor(dll: DLLDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		const webview = webviewPanel.webview;

		// Set up the webview
		webview.options = {
			enableScripts: true,
		};

		webview.html = '<!DOCTYPE html>' + render(
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'shared.css')}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'treeview.css')}/>
				</head>
				<body>

				<div class="tree">
					<TreeParent name={dll.uri.fsPath} icon={section} open={true}>
						<TreeParent name="Header" icon={folder} children={TreeChildren(dll.header)}/>
						<TreeParent name="Optional Header" icon={folder} children={TreeChildren(dll.opt!)}/>

						<TreeParent name="Sections" icon={folder} open={true}>
							{dll.sections.map(s =>
								<TreeParent name={s.Name} icon={section} children={TreeChildren(s)}/>
							)}
						</TreeParent>
						
						<TreeParent name="Directories" icon={folder} open={true}>
							{Object.entries(dll.directories!).filter(s => s[1].Size).map(s => {
								const read		= pe.DIRECTORIES[s[0]]?.read;
								const data		= dll.GetDataDir(s[1]);
								return <TreeParent name={s[0]} icon={section}>
									{read
										? TreeChildren(read(dll, data!))
										: <TreeItem name='data' value={data}/>
									}
								</TreeParent>
							})}
						</TreeParent>

					</TreeParent>
				</div>

				<script src={main.webviewUri(this.context, webview, 'shared.js')}></script>
				<script src={main.webviewUri(this.context, webview, 'treeview.js')}></script>
			</body></html>);

		this.receive = webview.onDidReceiveMessage(async message => OnMessage(this.context, dll.uri, message));

	}
}

//-----------------------------------------------------------------------------
//	MACH
//-----------------------------------------------------------------------------

class DyLibDocument implements vscode.CustomDocument {
	contents: any;
	constructor(readonly uri: vscode.Uri, data: Uint8Array) {
		this.contents = mach.load(data);
	}

	dispose() {}
}

function machFile(file: mach.MachFile) {
	return <>
	<TreeParent name="Header" icon={folder}>
		{TreeChildren(file.header)}
		</TreeParent>

		<TreeParent name="Commands" icon={folder} open={true}>
		{file.commands.map(c =>
			<TreeParent name={mach.CMD[c.cmd]} icon={section}>
				{TreeChildren(c.data)}
			</TreeParent>
		)}
	</TreeParent>
	</>;
}

function FATMachFile(file: mach.FATMachFile) {
	return file.archs.map(c => 
		<TreeParent name={c.cputype} icon={section}>
			{machFile(c.contents!)}
		</TreeParent>
	);
}

export class DyLibEditorProvider implements vscode.CustomReadonlyEditorProvider {
	private receive?: vscode.Disposable;

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.window.registerCustomEditorProvider('modules.dylibView', this));
	}

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		const data = await vscode.workspace.fs.readFile(uri).then(
			data => data,
			err => {
				vscode.window.showErrorMessage(err.message);
				throw err;
			}
		);
		return new DyLibDocument(uri, data);
	}

	async resolveCustomEditor(dll: DyLibDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		const webview = webviewPanel.webview;

		// Set up the webview
		webview.options = {
			enableScripts: true,
		};

		webview.html = '<!DOCTYPE html>' + render(
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'shared.css')}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'treeview.css')}/>
				</head>
				<body>

				<div class="tree">
					<TreeParent name={dll.uri.fsPath} icon={'file'} open={true}>
						{ dll.contents instanceof mach.MachFile ? machFile(dll.contents)
						: dll.contents instanceof mach.FATMachFile ? FATMachFile(dll.contents)
						: <div>Unknown file format</div>
						}
					</TreeParent>
				</div>

				<script src={main.webviewUri(this.context, webview, 'shared.js')}></script>
				<script src={main.webviewUri(this.context, webview, 'treeview.js')}></script>
			</body></html>);

		this.receive = webview.onDidReceiveMessage(async message => OnMessage(this.context, dll.uri, message));
	}
}

//-----------------------------------------------------------------------------
//	ELF
//-----------------------------------------------------------------------------

class ELFDocument implements vscode.CustomDocument {
	constructor(readonly uri: vscode.Uri, public contents: any) {}
	dispose() {}
}

export class ELFEditorProvider implements vscode.CustomReadonlyEditorProvider {
	private receive?: vscode.Disposable;

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.window.registerCustomEditorProvider('modules.elfView', this));
	}

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		const data = await vscode.workspace.fs.readFile(uri).then(
			data => data,
			err => {
				vscode.window.showErrorMessage(err.message);
				throw err;
			}
		);
		const e = elf.load(data);
		if (!e)
			throw new Error('not an ELF');
		return new ELFDocument(uri, e);
	}

	async resolveCustomEditor(dll: ELFDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		const webview = webviewPanel.webview;

		webview.options = {
			enableScripts: true,
		};

		const file = dll.contents as elf.ELFFile;
		webview.html = '<!DOCTYPE html>' + render(
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'shared.css')}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(this.context, webview, 'treeview.css')}/>
				</head>
				<body>

				<div class="tree">
					<TreeParent name={dll.uri.fsPath} icon={'file'} open={true}>
						{/*ELFFile(dll.contents)*/}
						<TreeParent name="Header" icon={folder} children={TreeChildren(file.header)}/>

						<TreeParent name="Segments" icon={folder} open={true}>
							{file.segments.map(([name, seg]) =>
								<TreeParent name={name} icon={section} children={TreeChildren(seg)}/>
							)}
						</TreeParent>

						<TreeParent name="Sections" icon={folder} open={true}>
							{file.sections.map(([name, sec]) =>
								<TreeParent name={name} icon={section} children={TreeChildren(sec)}/>
							)}
						</TreeParent>

						{file.symbols && <TreeParent name="Symbols">{
							file.symbols.map(([name, sym]) => <TreeParent name={name} icon={section} children={TreeChildren(sym)}/>)
						}</TreeParent>}

						{file.dynamic_symbols && <TreeParent name="Dynamic Symbols">{
							file.dynamic_symbols.map(([name, sym]) => <TreeParent name={name} icon={section} children={TreeChildren(sym)}/>)
						}</TreeParent>}

					</TreeParent>
				</div>

				<script src={main.webviewUri(this.context, webview, 'shared.js')}></script>
				<script src={main.webviewUri(this.context, webview, 'treeview.js')}></script>
			</body></html>);

		this.receive = webview.onDidReceiveMessage(async message => OnMessage(this.context, dll.uri, message));
	}
}
