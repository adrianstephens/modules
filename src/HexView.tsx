import * as vscode from 'vscode';
import {jsx, fragment, codicons, Icon} from "./shared/jsx";
import * as main from "./extension";

const radices = [
	{label: 'binary',   	 	radix: 2	},
	{label: 'octal',		 	radix: 8	},
	{label: 'decimal',  	 	radix: 10	},
	{label: 'signed decimal',	radix: -10	},
	{label: 'hex',   		 	radix: 16	},
];

const textCoding = [
	'none',
	'ASCII',
	'UTF-8',
	'UTF16-LE',
	'UTF16_BE',
	'SHIFT-JIS',
	'GB18030',
	'BIG5',
	'ISO-2022-KR',
];

const bytesPerLine = [
	{label: 'auto',		value: 0	},
	{label: '16',		value: 16	},
	{label: '32',		value: 32	},
	{label: '64',		value: 64	},
];

interface StreamingData {
	length: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

export function isStreamingData(data: any): data is StreamingData {
	return typeof data === 'object' && typeof data.length === 'number' && typeof data.read === 'function';
}

class HexEditor {
	public radix	= 16;
	public text		= 0;
	public columns 	= 0;
	contextOffset   = -1;

	waiting: Record<string, (message:any)=>void> = {};

	private async rpc(message: any, result: string) {
		return await new Promise<any>(resolve => {
			this.waiting[result] = resolve;
			this.webviewPanel.webview.postMessage(message);
		});
	}
	constructor(private context: vscode.ExtensionContext, public doc: StreamingData, public webviewPanel: vscode.WebviewPanel) {
		const webview = webviewPanel.webview;

		webview.options = {
			enableScripts: true,
		};

		webview.html = '<!DOCTYPE html>' +
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(context, webview, 'shared.css')}/>
					<link rel="stylesheet" type="text/css" href={main.webviewUri(context, webview, 'hexview.css')}/>
				</head>
				<body  data-vscode-context='{"preventDefaultContextMenuItems": true}'>
				<div class='container'>
					<div class='hexview'>
						<div class='addr'/>
						<div class='hex' data-vscode-context='{"section": "hex"}'/>
						<div class='text' data-vscode-context='{"section": "text"}'/>
					</div>
				</div>
				<script src={main.webviewUri(context, webview, 'shared.js')}></script>
				<script src={main.webviewUri(context, webview, 'hexview.js')}></script>
			</body></html>;

		const receive = webview.onDidReceiveMessage(async message => {
			console.log(message);
			switch (message.command) {
				case 'ready': {
					const state = message.state;
					this.radix		= state.radix;
					this.text		= state.text;
					this.columns 	= state.columns;
					webview.postMessage({command: 'set', total: this.doc.length});
					break;
				}

				case 'load': {
					const offset = message.offset;
					const length = message.length;
					const data = String.fromCharCode(...await doc.read(offset, length));
					webview.postMessage({command: 'data', offset, data});
					break;
				}
				case 'click':
					this.contextOffset = message.offset;
					HexEditorProvider.me.status.address.text = `0x${message.offset.toString(16)}`;
					break;

				default: {
					const f = this.waiting[message.command];
					if (f) {
						delete this.waiting[message.command];
						f(message);
					}
					break;
				}
			}
		});

		webviewPanel.onDidDispose(() => 
			receive.dispose()
		);
	}
	setTop(top: number) {
		this.webviewPanel.webview.postMessage({command: 'top', top});
	}
	setBytesPerLine(x: number) {
		this.columns = x;
		this.webviewPanel.webview.postMessage({command: 'columns', columns: x});
	}
	setRadix(radix: number) {
		this.radix  = radix;
		this.webviewPanel.webview.postMessage({command: 'radix', radix});
	}
	setTextCoding(coding: string) {
		this.text = textCoding.indexOf(coding);
		this.webviewPanel.webview.postMessage({command: 'text', text: this.text});
	}

	get length() {
		return this.doc.length;
	}
	
	async getState() {
		return (await this.rpc({command: 'getState'}, 'state')).state;
	}
	async getSelection() {
		return (await this.getState()).selection;
	}
	async getSelected() {
		const {a, b} = (await this.getState()).selection;
		return this.doc.read(Math.min(a, b), Math.abs(a - b) + 1);
	}

	addHighlight(a: number, b: number, color: string) {
		this.webviewPanel.webview.postMessage({command: 'addHighlight', a, b, color});
	}
	removeHighlight(offset: number) {
		this.webviewPanel.webview.postMessage({command: 'removeHighlight', offset});
	}
}

function showQuickPick<T extends vscode.QuickPickItem>(items: T[], initial?:T, placeholder?: string) {
	return new Promise<T|string|undefined>(resolve => {
		const quickPick = vscode.window.createQuickPick<T>();
		quickPick.items	= items;
		quickPick.placeholder = placeholder;
		if (initial)
			quickPick.activeItems = [initial];

		quickPick.onDidAccept(async () => {
			resolve(quickPick.selectedItems.length ? quickPick.selectedItems[0] : quickPick.value);
			quickPick.dispose();
		});
		quickPick.onDidHide(() => {
			resolve(undefined);
			quickPick.dispose();
		});

		quickPick.show();
	});
}


function createStatusBarItem(text:string, command:string, tooltip:string) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.text = text;
	item.command = command;
	item.tooltip = tooltip;
	return item;
}

type Status	= {
	address:	vscode.StatusBarItem;
	radix:		vscode.StatusBarItem;
	text:		vscode.StatusBarItem;
	columns:	vscode.StatusBarItem;
};

class HexDocument implements vscode.CustomDocument, StreamingData {
	constructor(readonly uri: vscode.Uri, public data: Uint8Array) {}
	dispose() {}

	get length() { return this.data.length; }
	async read(offset: number, length: number) { return this.data.subarray(offset, offset + length); }
}

class HexVirtualDocument implements vscode.CustomDocument, StreamingData {
	constructor(readonly uri: vscode.Uri, public length: number, private file: main.File) {}
	dispose() {
		this.file.dispose();
	}
	async read(offset: number, length: number) {
		return this.file.read(offset, length);
	}
}

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {
	static me: HexEditorProvider;
	active?: HexEditor;
	status: Status;
	closeGroups: number[] = [];

	static setOffsetStatus(top: number) {
		HexEditorProvider.me.status.address.text	= `0x${top.toString(16)}`;
	}

	private setActive(active?: HexEditor) {
		this.active = active;

		if (active) {
			for (const i of Object.values(this.status))
				i.show();

			active.getState().then(state => {
				const radix	= radices.find(r => r.radix === state.radix);
				this.status.address.text	= `0x${(active.contextOffset < 0 ? state.top : active.contextOffset).toString(16)}`;
				this.status.radix.text		= `Radix: ${radix?.label}`;
				this.status.text.text		= `Text: ${textCoding[state.text]}`;
				this.status.columns.text	= `Columns: ${state.columns || 'auto'}`;
			});
		} else {
			for (const i of Object.values(this.status))
				i.hide();
		}
	}

	constructor(private context: vscode.ExtensionContext) {
		HexEditorProvider.me = this;
		context.subscriptions.push(vscode.window.registerCustomEditorProvider('hex.view', this));

		this.status = {
			address:	createStatusBarItem('0x', 'hex.goto', 'Goto address'),
			radix:		createStatusBarItem('Radix: 16', 'hex.radix', 'Select the radix'),
			text:		createStatusBarItem('Text: ASCII', 'hex.text', 'Select the text coding'),
			columns:	createStatusBarItem('Columns: 16', 'hex.bytesPerLine', 'Select the number of columns')
		};

		context.subscriptions.push(vscode.Disposable.from(...Object.values(this.status)));

		context.subscriptions.push(vscode.commands.registerCommand('hex.open', (...params: any[]) => {
			let p0 = params.shift();
			if (!p0)
				return;

			if (typeof p0 === 'string')
				p0 = vscode.Uri.file(params[0]);
	
			if (p0 instanceof vscode.Uri)
				return vscode.commands.executeCommand('vscode.openWith', p0, 'hex.view', {preview: true});
	
			if (isStreamingData(p0)) {
				let title	= `binary`;
				let column	= vscode.ViewColumn.Active;

				let p1		= params.shift();
				if (typeof p1 === 'string') {
					title 	= p1;
					p1		= params.shift();
				}
				if (typeof p1 === 'number') {
					column	= p1;
					p1		= params.shift();
				}

				const webviewPanel	= vscode.window.createWebviewPanel("hex.view", title, column);
				this.openEditor(p0, webviewPanel);
			}
			
		}));
	
		context.subscriptions.push(vscode.commands.registerCommand('hex.goto', async () => {
			const editor = this.active;
			if (editor) {
				const state = await editor.getState();
				const x = await vscode.window.showInputBox({value: '0x', prompt: `Current 0x${state.top.toString(16)}. Type an address`});//. Type an address between 0 and 0x${editor.length}`});
				if (x) {
					const offset = parseInt(x, 16);
					if (!isNaN(offset)) {
						this.status.address.text = `0x${offset.toString(16)}`;
						editor.setTop(offset);
					}
				}
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.bytesPerLine', async () => {
			const editor = this.active;
			if (!editor)
				return;

			const current = bytesPerLine.find(r => r.value === editor.columns);
			const x = await showQuickPick(bytesPerLine, current, `current: ${editor.columns||'auto'}`);
			if (x) {
				editor.setBytesPerLine(typeof x === 'string' ? +x : x.value);
				this.status.columns.text = `Columns: ${x ? x : 'auto'}`;
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.radix', async () => {
			const editor = this.active;
			if (editor) {
				const current = radices.find(r => r.radix === editor.radix);
				const x = await showQuickPick(radices, current);
				if (x && typeof x !== 'string') {
					editor.setRadix(x.radix);
					this.status.radix.text = `Radix: ${x.label}`;
				}
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.text', async () => {
			const editor = this.active;
			if (editor) {
				const items = textCoding.map(i => ({label:i}));
				const x = await showQuickPick(items, items[editor.text]);
				//const x = await vscode.window.showQuickPick(textCoding, {});
				if (x && typeof x !== 'string') {
					editor.setTextCoding(x.label);
					this.status.text.text = `Text: ${x}`;
				}
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.copy_hex', async () => {
			const editor = this.active;
			if (editor) {
				const x = await editor.getSelected();
				vscode.env.clipboard.writeText(x.toString());
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.copy_text', async () => {
			const editor = this.active;
			if (editor) {
				const x = await editor.getSelected();
				vscode.env.clipboard.writeText(String.fromCharCode(...x));
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.addHighlight', async () => {
			const editor = this.active;
			if (editor) {
				const {a, b} = await editor.getSelection();
				editor.addHighlight(a, b, '#ffff0080');
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.removeHighlight', async () => {
			const editor = this.active;
			if (editor) {
				const {a, b} = await editor.getSelection();
				editor.removeHighlight(editor.contextOffset);
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.reopen', () => {
			const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as {
				[key: string]: any;
				uri: vscode.Uri | undefined;
			};
			if (activeTabInput.uri) {
				vscode.commands.executeCommand("vscode.openWith", activeTabInput.uri, "hex.view");
			}
		}));
	}

	watch(uri: vscode.Uri) {
		const path		= uri.path.split("/");
		const fileName	= path.pop()!;
		const base 		= vscode.Uri.from({scheme: uri.scheme, authority: uri.authority, path: path.join('/')});
		const watcher 	= vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, fileName));
		watcher.onDidDelete(uri => {
			for (const group of vscode.window.tabGroups.all) {
				for (const editor of group.tabs) {
					if (editor.input instanceof vscode.TabInputCustom)
					if (editor.input.viewType == 'hex.view' && editor.input.uri.toString() === uri.toString())
						vscode.window.tabGroups.close(editor, true);
				}
			}
			watcher.dispose();
		});
	}

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			const file = await main.openFile(uri);
			if (file)
				return new HexVirtualDocument(uri, stat.size, file);
/*
			if (uri.scheme === 'file') {
				if (stat.size > 0x10000)
					return new HexVirtualDocument(uri, stat.size, await main.NormalFile.open(uri));

			} else if (uri.scheme === main.DebugMemoryFileSystem.SCHEME) {
				this.watch(uri);
				return new HexVirtualDocument(uri, stat.size, main.DebugMemoryFileSystem.me.open(uri));

			} else if (uri.scheme === main.SubfileFileSystem.SCHEME) {
				const { uri: uri2, offset } = main.SubfileFileSystem.parseUri(uri);
				if (uri2.scheme === 'file')
					return new HexVirtualDocument(uri, offset.toOffset - offset.fromOffset, main.withOffset(await main.NormalFile.open(uri2), offset));
			}
				*/
			return new HexDocument(uri, await vscode.workspace.fs.readFile(uri));

		} catch (error) {
			console.log(error);
			throw vscode.FileSystemError.FileNotFound();
		}
	}

	async resolveCustomEditor(doc: HexDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		return this.openEditor(doc, webviewPanel);
	}

	openEditor(doc: StreamingData, webviewPanel: vscode.WebviewPanel) {
		const editor = new HexEditor(this.context, doc, webviewPanel);
		if (webviewPanel.active)
			this.setActive(editor);

		webviewPanel.onDidChangeViewState(event => this.setActive(event.webviewPanel.active ? editor : undefined));
	}
}

