import * as vscode from 'vscode';
import {jsx, fragment, codicons, Icon} from "./modules/jsx";
import * as fs from 'fs';

interface Radix {
	label: string;
	radix: number;
	signed: boolean;
}
const radices = [
	{label: 'binary',   	 	radix: 2,	signed: false},
	{label: 'octal',		 	radix: 8,	signed: false},
	{label: 'decimal',  	 	radix: 10,	signed: false},
	{label: 'signed decimal',	radix: 10,	signed: true},
	{label: 'hex',   		 	radix: 16,	signed: false},
];

const bytesPerLine = [
	{label: 'auto',		value: 0	},
	{label: '16',		value: 16	},
	{label: '32',		value: 32	},
	{label: '64',		value: 64	},
];

interface StreamingDocument extends vscode.CustomDocument {
	length: number;
	getChunk(offset: number, length: number): Promise<Uint8Array>;
}

class HexDocument implements StreamingDocument {
	constructor(readonly uri: vscode.Uri, public data: Uint8Array) {}
	dispose() {}

	get length() { return this.data.length; }
	async getChunk(offset: number, length: number) { return this.data.subarray(offset, offset + length); }
}

function openFile(uri: vscode.Uri) {
	return new Promise<number>((resolve, reject) => {
		fs.open(uri.fsPath, 'r', (err, fd) => {
			if (err)
				reject(err);
			else
				resolve(fd);
		});
	});
}

class HexVirtualDocument implements StreamingDocument {
	constructor(readonly uri: vscode.Uri, public length: number, private fd: number) {}
	dispose() {
		fs.close(this.fd);
	}

	async getChunk(offset: number, length: number) {
		return await new Promise<Uint8Array>((resolve, reject) => {
			const buffer = Buffer.alloc(length);
			fs.read(this.fd, buffer, 0, length, offset, (err, bytesRead, buffer) => {
				if (err)
					reject(err);
				else
					resolve(new Uint8Array(buffer));
			});
		});
	}
}


class HexEditor {
	static active?: HexEditor;
	public top		= 0;
	public radix	= 16;
	public signed   = false;
	public columns 	= 0;

	waiting: Record<string, (message:any)=>void> = {};

	private getUri(webview: vscode.Webview, name: string) {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', name));
	}

	constructor(private context: vscode.ExtensionContext, public doc: StreamingDocument, public webviewPanel: vscode.WebviewPanel) {
		if (webviewPanel.active)
			HexEditor.active = this;

		const webview = webviewPanel.webview;

		webview.options = {
			enableScripts: true,
		};

		webview.html = '<!DOCTYPE html>' +
			<html lang="en">
				<head>
					<meta charset="UTF-8"/>
					<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
					<link rel="stylesheet" type="text/css" href={this.getUri(webview, 'hexview.css')}/>
				</head>
				<body  data-vscode-context='{"preventDefaultContextMenuItems": true}'>
				<div class='container'>
					<div class='hexview'>
						<div class='addr'/>
						<div class='hex' data-vscode-context='{"section": "hex"}'/>
						<div class='ascii' data-vscode-context='{"section": "ascii"}'/>
					</div>
				</div>
				<script src={this.getUri(webview, 'hexview.js')}></script>
			</body></html>;

		const receive = webview.onDidReceiveMessage(async message => {
			console.log(message);
			switch (message.command) {
				case 'ready': {
					webview.postMessage({command: 'set',
						total: 		this.doc.length,
						top:		this.top,
						radix:  	this.radix,
						signed: 	this.signed,
						columns:	this.columns,
					});
					break;
				}

				case 'scroll':
					this.top = message.top;
					break;
				
				case 'load': {
					const offset = message.offset;
					const length = message.length;
					const data = String.fromCharCode(...await doc.getChunk(offset, length));
					webview.postMessage({command: 'data', offset, data});
					break;
				}

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
		webviewPanel.onDidChangeViewState(event => {
			console.log(this.doc.uri, event.webviewPanel.visible, event.webviewPanel.active);
			if (event.webviewPanel.active)
				HexEditor.active = this;
		});
	}

	setBytesPerLine(x: number) {
		this.columns = x;
		this.webviewPanel.webview.postMessage({command: 'columns', columns: x});
	}
	setRadix(radix: number, signed: boolean) {
		this.radix  = radix;
		this.signed = signed;
		this.webviewPanel.webview.postMessage({command: 'radix', radix, signed});
	}

	async getSelection() {
		const message = await new Promise<any>(resolve => {
			this.waiting.selection = resolve;
			this.webviewPanel.webview.postMessage({command: 'getSelection'});
		});
		const a = message.a;
		const b = message.b;
		return this.doc.getChunk(Math.min(a, b), Math.abs(a - b) + 1);
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

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {

	constructor(private context: vscode.ExtensionContext) {

		context.subscriptions.push(vscode.commands.registerCommand('hex.copy_hex', async () => {
			const editor = HexEditor.active;
			if (editor) {
				const x = await editor.getSelection();
				vscode.env.clipboard.writeText(x.toString());
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.copy_ascii', async () => {
			const editor = HexEditor.active;
			if (editor) {
				const x = await editor.getSelection();
				vscode.env.clipboard.writeText(String.fromCharCode(...x));
			}
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.bytesPerLine', async () => {
			const editor = HexEditor.active;
			if (!editor)
				return;

			const current = bytesPerLine.find(r => r.value === editor.columns);
			const x = await showQuickPick(bytesPerLine, current, `current: ${editor.columns||'auto'}`);
			if (x)
				editor.setBytesPerLine(typeof x === 'string' ? +x : x.value);
		}));

		context.subscriptions.push(vscode.commands.registerCommand('hex.radix', async () => {
			const editor = HexEditor.active;
			if (editor) {
				const current = radices.find(r => r.radix === editor.radix && r.signed == editor.signed);
				const x = await showQuickPick(radices, current);
				if (x && typeof x !== 'string')
					editor.setRadix(x.radix, x.signed);
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

	async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
		if (uri.scheme === 'file') {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > 0x10000) {
				return new HexVirtualDocument(uri, stat.size, await openFile(uri));
			}
		}
		return new HexDocument(uri, await vscode.workspace.fs.readFile(uri));
	}

	async resolveCustomEditor(doc: HexDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
		new HexEditor(this.context, doc, webviewPanel);
	}
}

