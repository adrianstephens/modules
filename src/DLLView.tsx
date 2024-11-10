import * as vscode from 'vscode';
import {DebugProtocol} from '@vscode/debugprotocol';
import {jsx, fragment, codicons, Icon} from "./shared/jsx";
import {PE, DIRECTORIES, RVAdata, DLLImports} from "./shared/pe";
import {DisassemblyView} from "./DisassemblyView";
import * as main from "./extension";

type IconType0	= string | vscode.Uri;
type IconType	= IconType0 | vscode.ThemeIcon | {
	light:	IconType0;
	dark:	IconType0;
};

const folder = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
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

function TreeParent(props: {name: string, icon?: IconType, open?: boolean, path?: boolean}, ...children: any[]) {
	return <div class={'caret' + (props.open ? ' caret-down' : '') + (props.path ? ' path' : '')}>
		<span>
			{props.icon && <Icon2 icon={props.icon}/>}
			{props.name}
		</span>
		<div class="children">
			{...children}
		</div>
	</div>;
}

function hasCustomToString(value: any): boolean {
    return value && value.toString !== Object.prototype.toString;
}

function TreeItem(props: {name: string, value: any}) {
	const {name, value} = props;
	switch (typeof value) {
		case 'undefined':
			return;
		case 'object':
			if (value instanceof RVAdata && value.data) {
				return <div class='binary' data-offset={value.data!.byteOffset} data-length={value.data!.byteLength} data-va={value.va} data-exec={value.characteristics?.MEM_EXECUTE}>
					<Icon2 icon={icon_binary}/>
					{`${name}: 0x${value.va.toString(16)}[0x${value.data!.byteLength.toString(16)}]`}
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
				return <TreeParent name={props.name} path={value instanceof DLLImports}>
					{Object.entries(value).map(([name, value]) => <TreeItem name={name} value={value}/> )}
				</TreeParent>
			}
		//case 'number':
		//case 'bigint':
		//	return <div><Icon2 icon={icon_number}/>{`${name}: ${value}`}</div>;

		default:
			return <div><Icon2 icon={icon_item}/> {`${name}: ${value}`}</div>;
	}
}

function TreeChildren(children: Record<string,any>) {
	return Object.entries(children).map(([name, value]) => <TreeItem name={name} value={value}/>);
}

class DLLDocument extends PE implements vscode.CustomDocument {
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

		webview.html = '<!DOCTYPE html>' +
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
						<TreeParent name="Header" icon={folder}>
							{TreeChildren(dll.header)}
						</TreeParent>

						<TreeParent name="Opt Header" icon={folder}>
							{TreeChildren(dll.opt!)}
						</TreeParent>

						<TreeParent name="Sections" icon={folder} open={true}>
							{dll.sections.map(s =>
								<TreeParent name={s.Name} icon="file">
									<TreeItem name='data' value={new RVAdata(s.VirtualAddress, dll.SectionData(s), s.Characteristics)}/>
									<TreeItem name='characteristics' value={s.Characteristics}/>
								</TreeParent>
							)}
						</TreeParent>
						
						<TreeParent name="Directories" icon={folder} open={true}>
							{Object.entries(dll.directories!).filter(s => s[1].Size).map(s => {
								const read		= DIRECTORIES[s[0]]?.read;
								const data		= dll.GetDataDir(s[1]);
								return <TreeParent name={s[0]} icon="file">
									{read
										? TreeChildren(read(dll, data!, s[1].VirtualAddress))
										: <TreeItem name='data' value={new RVAdata(s[1].VirtualAddress, data, dll.FindSectionRVA(s[1].VirtualAddress)?.Characteristics)}/>
									}
								</TreeParent>
							})}
						</TreeParent>

					</TreeParent>
				</div>

				<script src={main.webviewUri(this.context, webview, 'shared.js')}></script>
				<script src={main.webviewUri(this.context, webview, 'treeview.js')}></script>
			</body></html>;

		this.receive = webview.onDidReceiveMessage(async message => {
			switch (message.command) {
				case 'binary': {
					const length	= +message.length;
					const session	= vscode.debug.activeDebugSession;
					if (session) {
						const modules = await vscode.commands.executeCommand("modules.getModules") as DebugProtocol.Module[];
						const path = dll.uri.fsPath.toLowerCase();
						for (const i of modules) {
							if (i.path?.toLowerCase() === path) {
								const address = +(i.addressRange ?? 0) + +message.va;
								if ('exec' in message) {
									new DisassemblyView(this.context, session, address, length, `Disassembly @ 0x${address.toString(16)}`, vscode.ViewColumn.Beside);
								} else {
									const uri = main.DebugMemoryFileSystem.makeUri(session, `0x${address.toString(16)}`, {fromOffset: 0, toOffset: length});
									vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true, viewColumn: vscode.ViewColumn.Beside});
								}
								return;
							}
						}
					}
			
					const offset	= +message.offset;
					const file		= main.withOffset(await main.NormalFile.open(dll.uri), {fromOffset: offset, toOffset: offset + length});
					vscode.commands.executeCommand('hex.open', file, message.name ?? "binary", vscode.ViewColumn.Beside);
					
					//const uri = dll.uri.with({query: `baseAddress=${offset}`})
					//vscode.commands.executeCommand('vscode.openWith', uri, 'hexEditor.hexedit', {preview: true, viewColumn: vscode.ViewColumn.Beside});
					//const uri = main.SubfileFileSystem.makeUri(dll.uri, offset, length);
					//vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true, viewColumn: vscode.ViewColumn.Beside});
					break;
				}
				case 'path': {
					console.log(message.path);
					const session = vscode.debug.activeDebugSession;
					if (session) {
						const modules = await vscode.commands.executeCommand("modules.getModules") as DebugProtocol.Module[];
						const path = message.path.toLowerCase();
						for (const i of modules) {
							if (i.path && i.name.toLowerCase() === path) {
								vscode.commands.executeCommand('vscode.open', vscode.Uri.file(i.path));
								return;
							}
						}
					}
					break;
				}

			}
		});

	}
}

