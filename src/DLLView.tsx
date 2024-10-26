import * as vscode from 'vscode';
import {jsx, fragment, codicons, Icon} from "./modules/jsx";
import {PE, DIRECTORIES} from "./modules/pe";
import {SubfileFileSystem} from './extension';

type IconType0	= string | vscode.Uri;
type IconType	= IconType0 | vscode.ThemeIcon | {
	light:	IconType0;
	dark:	IconType0;
};

const icon_file = new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.blue'));
const icon_binary = new vscode.ThemeIcon('fileBinary', new vscode.ThemeColor('charts.green'));
const icon_number = new vscode.ThemeIcon('symbolNumber', new vscode.ThemeColor('charts.red'));
const icon_item = 'circle';


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

function TreeParent(props: {name: string, icon: IconType, open?: boolean}, ...children: any[]) {
	return <div class={props.open ? "caret caret-down" : "caret"}>
		<span>
			<Icon2 icon={props.icon}/>
			{props.name}
		</span>
		<div class="children">
			{...children}
		</div>
	</div>;
}

function TreeItem(props: {name: string, value: any}) {
	const {name, value} = props;
	switch (typeof value) {
		case 'object':
			if (value instanceof Buffer) {
				return <div class='binary' data-offset={value.byteOffset} data-length={value.length}>
					<Icon2 icon={icon_binary}/>
					{`${name}: 0x${value.byteOffset.toString(16)}[${value.length}]`}
				</div>;
			} else {
				return <TreeParent name={props.name} icon={icon_file}>
					{Object.entries(value).map(([name, value]) => <TreeItem name={name} value={value}/> )}
				</TreeParent>
			}
		case 'number':
		case 'bigint':
			return <div><Icon2 icon={icon_number}/>{`${name}: ${value}`}</div>;

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

	getUri(webview: vscode.Webview, name: string) {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', name));
	}

	constructor(private context: vscode.ExtensionContext) {
	}

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		return new DLLDocument(uri, await vscode.workspace.fs.readFile(uri));
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
					<link rel="stylesheet" type="text/css" href={this.getUri(webview, 'treeview.css')}/>
				</head>
				<body>

				<div class="tree">
					<TreeParent name={dll.uri.fsPath} icon={'file'} open={true}>
						<TreeParent name="Header" icon={'folder'}>
							{TreeChildren(dll.header)}
						</TreeParent>

						<TreeParent name="Opt Header" icon={'file'}>
							{TreeChildren(dll.opt!)}
						</TreeParent>

						<TreeParent name="Sections" icon={'file'} open={true}>
							{dll.sections.map(s => <TreeParent name={s.Name} icon="file">
								<TreeItem name="VirtualAddress" value={s.VirtualAddress}/>
								<TreeItem name="data" value= {dll.SectionData(s)}/>
							</TreeParent>)}
						</TreeParent>
						
						<TreeParent name="Directories" icon={'file'} open={true}>
							{Object.entries(dll.directories!).filter(s => s[1].Size).map(s => {
								const read		= DIRECTORIES[s[0]]?.read;
								const data		= dll.GetDataDir(s[1]);
								return <TreeParent name={s[0]} icon="file">
									{read
										? TreeChildren(read(dll, data!, s[1].VirtualAddress))
										: TreeChildren({VirtualAddress: s[1].VirtualAddress, data})
									}
								</TreeParent>
							})}
						</TreeParent>

					</TreeParent>
				</div>

				<script src={this.getUri(webview, 'treeview.js')}></script>
			</body></html>;

		this.receive = webview.onDidReceiveMessage(async message => {
			switch (message.command) {
				case 'binary': {
                    const uri = SubfileFileSystem.make(dll.uri, message.offset, message.length);
					//const uri = dll.uri.with({query: `baseAddress=${message.offset}`})
					vscode.commands.executeCommand('vscode.openWith', uri, 'hexEditor.hexedit', {preview: true, viewColumn: vscode.ViewColumn.Beside});
					//vscode.commands.executeCommand('vscode.openWith', uri, 'hex.view', {preview: true, viewColumn: vscode.ViewColumn.Beside});
					break;
				}
			}
		});

	}
}

