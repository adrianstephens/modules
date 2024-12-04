import * as vscode from 'vscode';
import * as fs from './shared/fs';
import * as path from 'path';
import { DebugProtocol } from '@vscode/debugprotocol';
import { render, Icon, CSP, Nonce, codicons, id_selector } from "./shared/jsx-runtime";
import * as main from "./extension";
import * as utils from "./shared/utils";
import * as pe from "./shared/pe";
import * as mach from "./shared/mach"
import * as elf from "./shared/elf"
import { DisassemblyView } from "./DisassemblyView";

type IconType0	= string | vscode.Uri;
type IconType	= IconType0 | vscode.ThemeIcon | {
	light:	IconType0;
	dark:	IconType0;
};

const folder 		= new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
const section 		= new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
const icon_group 	= new vscode.ThemeIcon('circleLargeFilled', new vscode.ThemeColor('charts.blue'));
const icon_binary 	= new vscode.ThemeIcon('fileBinary', new vscode.ThemeColor('charts.green'));
const icon_item 	= 'circleSmallFilled';
const icon_dll		= new vscode.ThemeIcon('fileSymlinkFile', new vscode.ThemeColor('charts.red'));

function TreeParent(props: {name: string, icon?: IconType, open?: boolean, selectable?: boolean, children?: any}) {
	return <div class={'caret' + (props.open ? ' caret-down' : '')} id={props.name}>
		<span>
			{props.icon && <Icon icon={props.icon}/>}
			{props.selectable ? <span class='select'>{props.name}</span> : props.name}
		</span>
		<div class="children">
			{props.children}
		</div>
	</div>;
}

function TreeParentMaybe(props: {name?: string, icon?: IconType, open?: boolean, selectable?: boolean, children?: any}) {
	return props.name
		? TreeParent({...props, name: props.name!})
		: props.children;
}


interface Context {
	memory_refs: Record<number, Uint8Array>;
}

function Flag(flags: number, mask: number, on: string, off = '-') {
	return (flags & mask) ? on : off;
}
function MemoryFlags(flags: number) {
	return Flag(flags, utils.MEM.WRITE, 'w') + Flag(flags, utils.MEM.EXECUTE, 'x') + Flag(flags, utils.MEM.READ, 'r');
}

function Data({name, data, context}: {name?: string, data: Uint8Array, context: Context}) {
	context.memory_refs[data.byteOffset] = data;
	return <div class='select binary' data-offset={data.byteOffset} data-length={data.length} icon={codicons.fileBinary}>
		{`${name && (name + ': ')}0x${data.byteOffset.toString(16)}[${data.length}]`}
	</div>;
}

function Memory({name, mm, context}: {name?: string, mm: utils.MappedMemory, context: Context}) {
	context.memory_refs[mm.data.byteOffset] = mm.data;
	return <div class='select binary' data-offset={mm.data.byteOffset} data-length={mm.data.byteLength} data-address={mm.address} data-flags={mm.flags} icon={codicons.fileBinary}>
		{`${name && (name + ': ')}0x${mm.address.toString(16)}[0x${mm.data!.byteLength.toString(16)}] ${MemoryFlags(mm.flags)}`}
	</div>;
}


function TreeItem({name, value, context}: {name?: string, value: any, context: Context}) {
	switch (typeof value) {
		case 'undefined':
			return;

		case 'object':
			if (value instanceof utils.MappedMemory) {
				return <Memory name={name} mm={value} context={context}/>

			} else if (value instanceof Uint8Array) {
				return <Data name={name} data={value} context={context}/>

			} else if (!(0 in value) && utils.hasCustomToString(value)) {
				return <div icon={codicons.circleSmallFilled}>
					{`${name}: ${value}`}
				</div>;

			} else if (Array.isArray(value[0]) && value[0].length === 2 && typeof(value[0][0] === 'string')) {
				return <TreeParentMaybe name={name} icon={section}>
					{value.map(([name, value]: [string, any]) => <TreeItem name={name} value={value} context={context}/> )}
				</TreeParentMaybe>

			} else {
				return <TreeParentMaybe name={name} icon={section}>
					{Object.entries(value).map(([name, value]) => <TreeItem name={name} value={value} context={context}/>)}
				</TreeParentMaybe>

			}

		default:
			return <div><Icon icon={icon_item}/> {`${name}: ${value}`}</div>;
	}
}
/*
function TreeChildren(children: Record<string,any> | [string,any][]) {
	return Array.isArray(children) &&Array.isArray(children[0]) && children[0].length === 2 && typeof(children[0][0] === 'string')
		? children.map(([name, value]: [string, any]) => <TreeItem name={name} value={value}/>)
		: Object.entries(children).map(([name, value]) => <TreeItem name={name} value={value}/>);
}
*/

function TreeChildren(value: any, context: Context) {
	return <TreeItem value={value} context={context}/>
}

async function findModule(name: string) {
	const session = vscode.debug.activeDebugSession;
	if (session) {
		const modules = await vscode.commands.executeCommand("modules.getModules") as DebugProtocol.Module[];
		name = name.toLowerCase();
		for (const i of modules) {
			if (i.name === name)
				return i;
			if (i.path && path.parse(i.path).name.toLowerCase() === name)
				return i;
		}
	}
}

//-----------------------------------------------------------------------------
//	PORTABLE EXECUTABLE
//-----------------------------------------------------------------------------

class DLLDocument implements vscode.CustomDocument {
	pe?:		pe.PE;
	mach?:		mach.MachFile;
	fatMach?:	mach.FATMachFile;
	elf?:		elf.ELFFile;

	constructor(readonly uri: vscode.Uri, data: Uint8Array) {
		if (pe.PE.check(data))
			this.pe = new pe.PE(data);
		else if (mach.MachFile.check(data))
			this.mach = new mach.MachFile(data);
		else if (mach.FATMachFile.check(data))
			this.fatMach = new mach.FATMachFile(data);
		else if (elf.ELFFile.check(data))
			this.elf = new elf.ELFFile(data);
	}

	dispose() {}
}

function peFile(dll: pe.PE, context: Context) {
	const { DataDirectory, ...opt } = dll.opt!;
  
	return <>
		<TreeParent name="Header" icon={folder} children={TreeChildren(dll.header, context)}/>
		<TreeParent name="Optional Header" icon={folder} children={TreeChildren(opt, context)}/>

		<TreeParent name="Sections" icon={folder} open={true}>
			{dll.sections.map(s =>
				<TreeParent name={s.Name} icon={section} children={TreeChildren(s, context)}/>
			)}
		</TreeParent>

		<TreeParent name="Directories" icon={folder} open={true}>
			{Object.entries(dll.directories!).filter(s => s[1].Size).map(s => {
				const data		= dll.GetDataDir(s[1]);
				if (data) {
					const read		= pe.DIRECTORIES[s[0]]?.read;
					if (!read)
						return <TreeItem name={s[0]} value={data} context={context}/>

					const data2 = read!(dll, data);
					return <TreeParent name={s[0]} icon={section}>{
						s[0] === 'EXPORT' ? (data2 as [number, string, utils.MappedMemory][]).map(([ordinal, name, mem]) => 
							<Memory name={`#${ordinal}: ${name}`} mm={mem} context={context}/>
						)
						: s[0] === 'IMPORT' ? (data2 as [string, any[]][]).map(([name, entries]) =>
							<TreeParent name={name} icon={icon_dll} selectable>
								{entries.map(v => <div class='dllentry' icon={codicons.circleSmallFilled}>{v}</div>)}
							</TreeParent>
						)
						: TreeChildren(data2, context)
					}</TreeParent>
				}
			})}
		</TreeParent>
	</>
}

function machFile(file: mach.MachFile, context: Context) {
	return <>
	<TreeParent name="Header" icon={folder}>
		{TreeChildren(file.header, context)}
		</TreeParent>

		<TreeParent name="Commands" icon={folder} open={true}>
		{file.commands.map(c =>
			//<TreeItem name={mach.CMD[c.cmd]} value={c.data}></TreeItem>
			<TreeParent name={mach.CMD[c.cmd]} icon={section}>
				{TreeChildren(c.data, context)}
			</TreeParent>
		)}
	</TreeParent>
	</>;
}

function FATMachFile(file: mach.FATMachFile, context: Context) {
	return file.archs.map(c => 
		<TreeParent name={c.cputype} icon={section}>
			{machFile(c.contents!, context)}
		</TreeParent>
	);
}

function elfFile(file: elf.ELFFile, context: Context) {
	return <>
		<TreeParent name="Header" icon={folder} children={TreeChildren(file.header, context)}/>

		<TreeParent name="Segments" icon={folder} open={true}>
			{file.segments.map(([name, seg]) =>
				<TreeParent name={name} icon={section} children={TreeChildren(seg, context)}/>
			)}
		</TreeParent>

		<TreeParent name="Sections" icon={folder} open={true}>
			{file.sections.map(([name, sec]) =>
				<TreeParent name={name} icon={section} children={TreeChildren(sec, context)}/>
			)}
		</TreeParent>

		{file.symbols && <TreeParent name="Symbols">{
			file.symbols.map(([name, sym]) => <TreeParent name={name} icon={section} children={TreeChildren(sym, context)}/>)
		}</TreeParent>}

		{file.dynamic_symbols && <TreeParent name="Dynamic Symbols">{
			file.dynamic_symbols.map(([name, sym]) => <TreeParent name={name} icon={section} children={TreeChildren(sym, context)}/>)
		}</TreeParent>}
	</>
}

class DllEditor {
	static map: Record<string, DllEditor> = {};
	memory_refs: Record<number, Uint8Array> = {};
	selected?:	string;

	constructor(public dll: DLLDocument, public webviewPanel: vscode.WebviewPanel) {
		DllEditor.map[dll.uri.toString()] = this;

		const webview = webviewPanel.webview;

		// Set up the webview
		webview.options = {
			enableScripts: true,
		};

		const context: Context = {memory_refs: this.memory_refs};
		const nonce = Nonce();
		webview.html = '<!DOCTYPE html>' + render(
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<CSP csp={webview.cspSource} nonce={nonce}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(webview, 'shared.css')}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(webview, 'treeview.css')}/>
				</head>
				<body>

				<div class="tree">
					<TreeParent name={dll.uri.fsPath} icon={section} open={true}>
						{dll.pe && peFile(dll.pe, context)}
						{dll.mach && machFile(dll.mach, context)}
						{dll.fatMach && FATMachFile(dll.fatMach, context)}
						{dll.elf && elfFile(dll.elf, context)}
					</TreeParent>
				</div>

				<script nonce={nonce} src={main.webviewUri(webview, 'shared.js')}></script>
				<script nonce={nonce} src={main.webviewUri(webview, 'treeview.js')}></script>
			</body></html>);

		webview.onDidReceiveMessage(async message => {
			console.log(message.path);
			switch (message.command) {
				case 'select':
					this.select(message.selector);
					if (message.offset) {
						//binary
						const offset	= +message.offset;
						const length	= +message.length;
						const flags		= +message.flags;
						const session	= vscode.debug.activeDebugSession;
						const module	= session && await findModule(path.parse(dll.uri.path).name);
						const address	= module && (flags & utils.MEM.RELATIVE) ? +message.address + +module.addressRange! : +message.address;
							
						// if exec is set, see if we can disassemble it
						if (module && (flags & utils.MEM.EXECUTE) && await DisassemblyView.canDisassemble(session, address)) {
							new DisassemblyView(main.extension_context, session, address, length, `Disassembly @ 0x${address.toString(16)}`, vscode.ViewColumn.Beside);
							return;
						}
			/*
						// if it's in memory_refs, use it
						const ref = this.memory_refs[offset];
						if (ref) {
							vscode.commands.executeCommand('hex.open', ref, message.name ?? "binary", {viewColumn: vscode.ViewColumn.Beside, preview: true});
							return;
						}
			*/
						// otherwise see if it's in debug memory
						if (module) {
							const uri = main.DebugMemoryFileSystem.makeUri(session, `0x${address.toString(16)}`, {fromOffset: 0, toOffset: length});
							vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {viewColumn: vscode.ViewColumn.Beside, preview: true});
							return;
						}
				
						// otherwise load and use it from disk (or whatever)
						const uri	= fs.withOffset(dll.uri, {fromOffset: offset, toOffset: offset + length});
						vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {viewColumn: vscode.ViewColumn.Beside, preview: true});
						//const file	= main.withOffset(await main.openFile(dll.uri), {fromOffset: offset, toOffset: offset + length});
						//vscode.commands.executeCommand('hex.open', file, message.name ?? "binary", {viewColumn: vscode.ViewColumn.Beside, preview: true});
					} else  {
						//non-binary
						const module	= await findModule(message.path);
						if (module)
							vscode.commands.executeCommand('vscode.open', vscode.Uri.file(module.path!), {viewColumn: vscode.ViewColumn.Beside, preview: true});
					}
					break;

				case 'dllentry': {
					const module	= await findModule(message.path);
					if (module) {
						const path = vscode.Uri.file(module.path!);
						let editor = DllEditor.map[path.toString()];
						if (editor) {
							editor.reveal();
						} else {
							await vscode.commands.executeCommand('vscode.open', path, {viewColumn: vscode.ViewColumn.Beside, preview: true});
							editor = DllEditor.map[path.toString()];
						}
						if (editor) {
							editor.select_entry(message.entry);
						}
					}
					break;
				}
		
			}
		});

		webviewPanel.onDidDispose(() => delete DllEditor.map[dll.uri.toString()]);
	}

	private addClass(selector: string, clss: string, enable:boolean) {
		this.webviewPanel.webview.postMessage({command: 'add_class', selector, class: clss, enable});
	}

	reveal() {
		this.webviewPanel.reveal();
	}

	select(selector: string) {
		if (this.selected)
			this.addClass(this.selected, 'selected', false);
		this.addClass(this.selected = selector, 'selected', true);
	}

	select_entry(entry: string) {
		const exports = this.dll.pe?.ReadDirectory('EXPORT') as [number, string, utils.MappedMemory][];
		if (exports) {
			let index;
			if (entry.startsWith("ordinal_")) {
				const ordinal = parseInt(entry.substring(8));
				index = exports.findIndex(i => i[0] === ordinal);
			} else {
				index = exports.findIndex(i => i[1] === entry);
			}
			if (index >= 0) {
				const selector = `#EXPORT .children > div:nth-child(${index + 1})`;
				this.select(selector);
				this.webviewPanel.webview.postMessage({command: 'scroll_to', selector});
			}
		}
	}
}

export class DllEditorProvider implements vscode.CustomReadonlyEditorProvider {

	constructor(context: vscode.ExtensionContext) {
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
		const editor = new DllEditor(dll, webviewPanel);
	}
	
}
