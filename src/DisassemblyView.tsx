/* eslint-disable no-empty */
import * as vscode from "vscode";
import { DebugProtocol } from "@vscode/debugprotocol";
import { jsx, fragment, codicons, id_selector } from "./shared/jsx";
import * as utils from "./shared/utils";
import * as main from "./extension";

type DisassembleResponse = DebugProtocol.DisassembleResponse['body'];

function findInstructionIndex(array: DebugProtocol.DisassembledInstruction[], address: number) {
	let low = 0, high = array.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (+array[mid].address < address)
			low = mid + 1;
		else
			high = mid;
	}
	return low;
}

export class DisassemblyView {
	addresses: number[] = [];//address, accumulated labels
	labels: number[] = [];
	
	constructor(private context: vscode.ExtensionContext, private session: vscode.DebugSession, private address:number, length:number, title: string, column: vscode.ViewColumn) {
		const panel = vscode.window.createWebviewPanel("modules.disassenbly", title, column, { enableScripts: true });
		

		panel.webview.html = "<!DOCTYPE html>" + <html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no" />
				<link rel="stylesheet" type="text/css" href={main.webviewUri(context, panel.webview, "shared.css")} />
				<link rel="stylesheet" type="text/css" href={main.webviewUri(context, panel.webview, "disassembly.css")} />
			</head>

			<body>
				<div id="root"/>
				<script src={ main.webviewUri(context, panel.webview, "shared.js")}></script>
				<script src={ main.webviewUri(context, panel.webview, "disassembly.js")}></script>
			</body>
		</html>;

		this.countInstructions(address, length, (total:number) => {
			panel.webview.postMessage({command:'total', total});
		});

		const recv = panel.webview.onDidReceiveMessage((message: any) => {
			switch (message.command) {
				case 'request':
					try {
						const [memoryReference, instructionOffset] = this.getAddress(message.offset);
						session.customRequest("disassemble", {
							memoryReference,
							instructionOffset,
							instructionCount:	message.count,
							resolveSymbols:		true,
						}).then((res: DisassembleResponse) => {
							panel.webview.postMessage({command:'instructions', offset: message.offset, instructions: res?.instructions});
						}, reason =>
							console.log(memoryReference, instructionOffset)
						);
					} catch (e) {
						console.log(e);
					}
					break;
			}
		});

		panel.onDidDispose(() => recv.dispose());
		panel.onDidChangeViewState(event => {
			console.log(event);
		});

	}

	getAddress(offset: number) {
		console.log(`get address: ${offset.toString(16)}`);
		const label 	= utils.lowerBound(this.labels, offset, (a, b, i) => a < b - i);
		const instr		= offset - label;
		const index		= Math.floor(instr / 256);
		if (index >= this.addresses.length)
			throw new Error('index out of range');
		
		const addr = this.addresses[index];

		return ['0x' + (this.address + addr).toString(16), instr % 256];
	}

	async countInstructions(address:number, length:number, post:(total:number)=>void) {
		let		addr	= 0;
		const	probe_size	= 256;

		try {
			while (addr < length) {
				const start = this.addresses.length * probe_size
				this.addresses.push(addr);

				const res : DisassembleResponse = await this.session.customRequest("disassemble", {
					memoryReference:	'0x' + (address + addr).toString(16),
					instructionOffset:	0,
					instructionCount:	probe_size + 1,
					resolveSymbols:		false
				});
				if (!res)
					break;

				addr = +res.instructions[probe_size].address - address;
				const num = addr > length ? findInstructionIndex(res.instructions, address + length) : probe_size;

				for (let i = 0; i < num; i++) {
					if (res.instructions[i].symbol)
						this.labels.push(start + i);
				}

				post(start + num + this.labels.length);
			}
		} catch (e) {
			console.log(e);
		}
	}

}