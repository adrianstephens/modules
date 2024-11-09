const state			= {top:0, radix:16, text:1, columns:0, selection:{a:-1, b:-1}, highlights:[], ...vscode.getState()};

const container		= document.querySelector('.container');
const hexview		= document.querySelector('.hexview');
const addr_col		= document.querySelector('.addr');
const hex_col		= document.querySelector('.hex');
const text_col		= document.querySelector('.text');
const tooltip 		= createElement('div', {className: 'tooltip'});
const color_picker	= createElement('input', {type: 'color', value: '#ff0000', className: 'color-picker invisible'});

const body_style	= getComputedStyle(document.body);
const hex_style		= getComputedStyle(hex_col);

const row_height	= parseInt(body_style.getPropertyValue('--row-height'));
const digit_width	= parseInt(body_style.getPropertyValue('--digit-width'));
const chunk_size	= 1024;
const chunks		= [];
const hex_divs		= [];
const text_divs		= [];
const addr_divs		= [];
const blocks		= [];

let num_digits		= 2;
let hex_width		= (num_digits + 1) * digit_width;
let total			= 0;
let num_columns		= 0;
let current_radix	= 16;
let current_signed	= false;
let little_endian	= true;
let auto_columns	= false;
let filling 		= false;
let selecting		= false;

class Selection {
	constructor(parent, color) {
		this.element = createElement('div', {className: 'selection'});
		if (color)
			this.element.style.backgroundColor = color;
		parent.appendChild(this.element);
	}

	set(a, b, num_columns) {
		if (a > b) {
			const t = a;
			a = b;
			b = t;
		}
		++b;
	
		const element = this.element;
		const startY = Math.floor(a / num_columns);
		const endY = Math.floor(b / num_columns);
		element.setAttribute('data-multi-row', startY != endY);
	
		element.style.setProperty('--start-x', a % num_columns);
		element.style.setProperty('--start-y', startY);
		element.style.setProperty('--end-x', b % num_columns);
		element.style.setProperty('--end-y', endY);
	}
	remove() {
		this.element.parentNode.removeChild(this.element);
	}
}

class Highlight {
	constructor(a, b, color) {
		this.a 		= a;
		this.b 		= b;
		this.color 	= color;
		this.hex	= new Selection(hex_col, color);
		this.text	= new Selection(text_col, color);
	}
	remove() {
		this.hex.remove();
		this.text.remove();
	}
	update(num_columns) {
		this.hex.set(this.a, this.b, num_columns);
		this.text.set(this.a, this.b, num_columns);
	}
	setColor(color) {
		this.color = color;
		this.hex.element.style.backgroundColor = color;
		this.text.element.style.backgroundColor = color;
	}
	contains(i) {
		return i >= this.a && i <= this.b;
	}
}


class Spacer2D {
	constructor(parent) {
		this.spacer = parent.appendChild(document.createElement("div"));
		parent.appendChild(document.createElement("div"));
	}
	
	set(offset, num_columns) {
		const row_skip = Math.floor(offset / num_columns);
		const col_skip = offset % num_columns;

		const row_spacer = this.spacer;
		const col_spacer = row_spacer.nextSibling;

		if (row_skip > 0) {
			row_spacer.style.display = 'block';
			row_spacer.style.gridColumnStart = 1;
			row_spacer.style.gridColumnEnd = num_columns + 1;
			row_spacer.style.gridRowStart = 1;
			row_spacer.style.gridRowEnd = row_skip + 1;
		} else {
			row_spacer.style.display = 'none';
		}

		if (col_skip > 0) {
			col_spacer.style.display = 'block';
			col_spacer.style.gridColumnStart = 1;
			col_spacer.style.gridColumnEnd = col_skip + 1;
		} else {
			col_spacer.style.display = 'none';
		}
	}
}

const hex_spacer	= new Spacer2D(hex_col);
const text_spacer	= new Spacer2D(text_col);
const vscroll 		= new ScrollBar(document.body, container, false);
const hscroll 		= new ScrollBar(hex_col, hex_col, true);
const hex_selection		= new Selection(hex_col);
const text_selection	= new Selection(text_col);
const highlights	= [];
let current_highlight;

document.addEventListener('DOMContentLoaded', () => {
	document.body.appendChild(tooltip);
	addr_col.textContent = '00000000';
	vscode.postMessage({command: 'ready', state});

	hex_col.appendChild(color_picker);
	color_picker.addEventListener('input', event => {
		if (current_highlight) {
			const color = event.target.value + '80';
			current_highlight?.setColor(color);
			const i = highlights.indexOf(current_highlight);
			state.highlights[i].color = color;
			vscode.setState(state);
		}
	});
});

function getOffset(span) {
	return span ? span.parentElement.chunk * chunk_size + +span.dataset.index : -1;
}

function setSpacer(offset, col) {
	const spacer = col.firstElementChild;

	if (offset > 0) {
		spacer.style.display = 'block';
		spacer.style.gridRowStart = 1;
		spacer.style.gridRowEnd = offset + 1;
	} else {
		spacer.style.display = 'none';
	}
}

function getBlock() {
	if (blocks.length === 0) {
		const div	= document.createElement("div");
	
		for (let i = 0; i < chunk_size; i++) {
			const span	= document.createElement("span");
			span.dataset.index = i;
			div.appendChild(span);
		}

		blocks.push(div);
	}
	return blocks.length === 1
		? blocks[0].cloneNode(true)
		: blocks.pop();
}

function discardBlock(placeholder) {
	blocks.push(placeholder);
}

function insertBlock(i, col, divs, className) {
	const block	= getBlock();
	block.chunk = i;
	block.className = className;
	divs[i]		= block;

	let before = divs[i + 1];
	if (!before && divs[i - 1])
		before = divs[i - 1].nextSibling;
	col.insertBefore(block, before);
	return block;
}

//-----------------------------------------------------------------------------
//	radix + text coding
//-----------------------------------------------------------------------------

function getNumber(value, radix, digits) {
	return value.toString(radix).padStart(digits, '0');
}

function getValueString(byte) {
	return current_signed && byte >= 128
		? '-' + getNumber(256 - byte, current_radix, num_digits)
		: getNumber(byte, current_radix, num_digits);
}

function setRadix(radix) {
	current_radix	= Math.abs(radix);
	current_signed	= radix < 0;
	const	digits	= current_radix == 2 ? 8 : current_radix < 16 ? 3 : 2;
	const	digits1	= digits + (current_signed ? 1 : 0);
	document.body.style.setProperty('--digits', digits1.toString());
	hex_width		= (digits1 + 1) * digit_width;
	num_digits		= current_radix == 10 ? 0 : digits;
}

function byteSwap16(i) {
	return (i >> 8) | ((i & 0xff) << 8);
}

const dot = '.'.charCodeAt(0);
const cont = 0xb7;//0x25cc;//32;//'.'.charCodeAt(0);

function getCharactersUTF8(data) {
	const str = new TextDecoder('utf8').decode(data);
	const result = [];
	for (let i = 0; i < str.length; i++) {
		const c = str.codePointAt(i);
		result.push(c > 32 ? c : dot);
		if (c >= 0x80) {
			result.push(cont);
			if (c >= 0x800) {
				result.push(cont);
				if (c >= 0x10000) {
					++i;
					result.push(cont);
				}
			}
		}
	}
	return result;
}

function getCharactersSHIFT_JIS(data) {
	let result = [];
	const str = new TextDecoder('shift-jis').decode(data);
	for (let i = 0, j = 0; i < data.length; i++) {
		const c = str.codePointAt(j++);
		const d = data[i];
		result.push(c > 32 ? c : dot);

		if (d > 0xdf || (d >= 0x80 && d < 0xa1)) {
			const d1 = data[i + 1];
			if (d1 >= 0x40 && d1 <= 0xFC && d1 !== 0x7F) {
				result.push(cont);
				++i;
			}
		}
	}
	return result;
}

function getCharactersGB18030(data) {
	let result = [];
	const str = new TextDecoder('gb18030').decode(data);
	for (let i = 0, j = 0; i < data.length; i++) {
		const c = str.codePointAt(j++);
		const d = data[i];
		result.push(c > 32 ? c : dot);

		if (d >= 0x81 && d <= 0xFE) {
			const d1 = data[i + 1];

			if (d1 >= 0x40 && d1 <= 0xFE && d1 !== 0x7F) {
				++i;
				result.push(cont);

			} else if (d1 >= 0x30 && d1 <= 0x39) {
				const d2 = data[i + 2];
				const d3 = data[i + 3];
				if (d2 >= 0x81 && d2 <= 0xFE && d3 >= 0x30 && d3 <= 0x39) {
					i += 3;
					result.push(cont);
					result.push(cont);
					result.push(cont);
				}
			}
		}
	}
	//if (j !== str.length)
	//	console.log(`character usage - ${j} != ${str.length}!`);

	return result;
}

function getCharactersBIG5(data) {
	let result = [];
	const str = new TextDecoder('big5').decode(data);
	for (let i = 0, j = 0; i < data.length; i++) {
		const c = str.codePointAt(j++);
		const d = data[i];
		result.push(c > 32 ? c : dot);

		if (d >= 0xA1 && d <= 0xFE) {
			const d1 = data[i + 1];
			if ((d1 >= 0x40 && d1 <= 0x7E) || (d1 >= 0xA1 && d1 <= 0xFE)) {
				++i;
				result.push(cont);
			}
		}
	}
	return result;
}

function getCharactersISO2020KR(data) {
	const str = new TextDecoder('iso-2022-kr').decode(data);
	for (let i = 0, j = 0; i < data.length; i++) {
		const d = data[i];
		if (d === 0x1B) {
			result.push(cont);
			while (++i < data.length && data[i] !== 0x28 && data[i] !== 0x4A && data[i] !== 0x42)
				result.push(cont);
		} else {
			const c = str.codePointAt(j++);
			result.push(c > 32 ? c : dot);

			if (d >= 0xA1 && d <= 0xFE) {
				const d1 = data[i + 1];
				if (d1 >= 0xA1 && d1 <= 0xFE) {
					++i;
					result.push(cont);
				}
			}
		}
	}
	return result;
}

function getCharacters(data) {
	switch (state.text) {
		case 0:	//none
			return;

		case 1:	//ASCII
			return Array.from(data).map(c => c > 32 && c < 127 ? c : dot);

		case 2:	//UTF-8
			return getCharactersUTF8(data);

		case 3:	{//UTF-16LE
			const data2 = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
			return Array.from(data2).map(c => [32, c > 32 ? c : dot]).flat();
		}
		case 4:	{//UTF-16BE
			const data2 = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
			return Array.from(data2).map(c0 => { const c = byteSwap16(c0); return [32, c > 32 ? c : dot];}).flat();
		}
		case 5: //SHIFT-JIS
			return getCharactersSHIFT_JIS(data);

		case 6: //gb18030
			return getCharactersGB18030(data);

		case 7: //big5
			return getCharactersBIG5(data);

		case 8: //iso-2022-kr
			return getCharactersISO2020KR(data);

		default:
			return Array(data.length).fill(dot);
	}
}

function setText(text) {
//	text_col.style.display = text ? '' : 'none';
}

//-----------------------------------------------------------------------------
//	scroll
//-----------------------------------------------------------------------------

function requestChunk(i) {
	if (!chunks[i]) {
		chunks[i] = 'pending';

		insertBlock(i, hex_col, hex_divs, 'placeholder');
		insertBlock(i, text_col, text_divs, 'placeholder');
		vscode.postMessage({
			command: 'load',
			offset: i * chunk_size,
			length: chunk_size
		});
	}
}

function fillHexChunk(hex, data) {
	const size	= data.length;

	for (let k = 0; k < size; k++)
		hex.children[k].textContent = getValueString(data[k]);

	for (let k = size; k < chunk_size; k++)
		hex.children[k].textContent		= '';
}

function fillTextChunk(text, data) {
	if (state.text) {
		const size	= data.length;
		const s		= getCharacters(data);
		if (s.length !== size)
			console.log(`character len mismatch - ${s.length} != ${size}!`);

		let k = 0;
		for (const c of s)
			text.children[k++].textContent = String.fromCodePoint(c);
		for (let k = size; k < chunk_size; k++)
			text.children[k].textContent	= '';
	}
}

function fillChunk(chunk, data) {
	if (chunks[chunk] !== 'pending') {
		console.log("fillChunk: invalid state", chunks[chunk]);
	}
	if (chunks[chunk] === 'pending') {
		const hex	= hex_divs[chunk];
		const text	= text_divs[chunk];

		fillHexChunk(hex, data);
		hex.className	= 'data';

		fillTextChunk(text, data);
		text.className	= 'data';

		chunks[chunk] 	= data;
	}
}

function fillData(y) {
//	hex_col.style.height = `${window.innerHeight - hexview.getBoundingClientRect().top}px`;

	const rows		= Math.ceil(total / num_columns);
	const top 		= Math.min(Math.floor(y / row_height), rows);
	const bottom	= Math.min(Math.ceil((y + window.innerHeight) / row_height), rows);

	const top_addr	= top * num_columns;
	if (top_addr !== state.top) {
		state.top	= top_addr;
		vscode.setState(state);
		//setTimeout(()=> vscode.postMessage({command: 'scroll', top: top_addr}), 0);
	}

	const addr0 = Math.floor(top / chunk_size);
	const addr1 = Math.ceil(bottom / chunk_size);
	for (const i in addr_divs) {
		if (i < addr0 || i >= addr1) {
			addr_col.removeChild(addr_divs[i]);
			discardBlock(addr_divs[i]);
			delete addr_divs[i];
		}
	}
	for (let i = addr0; i < addr1; i++) {
		if (!addr_divs[i]) {
			const addr = insertBlock(i, addr_col, addr_divs, 'data');
			const offset = i * chunk_size;
			for (let k = 0; k < chunk_size; k++)
				addr.children[k].textContent = ((offset + k) * num_columns).toString(16).padStart(8, '0');
		}
	}

	setSpacer(addr0 * chunk_size, addr_col);

	const a = Math.floor(top * num_columns / chunk_size);
	const b = Math.ceil(bottom * num_columns / chunk_size);

	const extra = 1;
	const a1 = Math.max(a - extra, 0), b1 = Math.min(b + extra, Math.floor(total / chunk_size));

	for (const i in chunks) {
		if (i < a || i >= b) {
		//if (i < a1 || i >= b1) {
			hex_col.removeChild(hex_divs[i]);
			text_col.removeChild(text_divs[i]);
			discardBlock(hex_divs[i]);
			discardBlock(text_divs[i]);
			delete hex_divs[i];
			delete text_divs[i];
			delete chunks[i];
		}
	}

	hex_spacer.set(a * chunk_size, num_columns);
	text_spacer.set(a * chunk_size, num_columns);

	for (let i = a; i < b; i++)
		requestChunk(i);

}


let ticking = false;
container.addEventListener("scroll", event => {
	if (!ticking) {
        window.requestAnimationFrame(() => {
			const y	= container.scrollTop;
			vscroll.setThumb(y);
			fillData(y);
			ticking = false;
        });
        ticking = true;
    }
});
/*
container.addEventListener("scroll", event => {
	const y	= container.scrollTop;
	vscroll.setThumb(y);
	fillData(y);
});
*/

//-----------------------------------------------------------------------------
//	columns
//-----------------------------------------------------------------------------

function calcColumns() {
	return Math.floor(hex_col.getBoundingClientRect().width / hex_width);
}

function calcScroll(top, columns) {
	return Math.max(Math.floor(Math.min(top, total - window.innerHeight / row_height * columns) / columns) * row_height, 0);
}

function setActualColumns(columns, y) {
	num_columns = columns;
	document.body.style.setProperty('--num-columns', columns);

	//update grid height

	const rows		= Math.ceil(total / columns);
	const height 	= rows * row_height;
	hexview.style.height = hexview.style.maxHeight = `${height}px`;

	// update selection

	if (state.selection.a >= 0) {
		hex_selection.set(state.selection.a, state.selection.b, num_columns);
		text_selection.set(state.selection.a, state.selection.b, num_columns);
	}
	for (const h of highlights)
		h.update(num_columns);

	//remove all address blocks

	for (const i in addr_divs) {
		addr_col.removeChild(addr_divs[i]);
		discardBlock(addr_divs[i]);
		delete addr_divs[i];
	}

	container.scrollTop = y;
}

window.addEventListener('resize', () => {
	const columns	= state.columns || calcColumns();
	const y			= calcScroll(state.top, columns);
	if (columns != num_columns)
		setActualColumns(columns, y);
	vscroll.setThumb(y);
	fillData(y);
	hscroll.update();
});

function setColumns(columns) {
//	text_col.style.overflowX = columns ? 'visible' : 'hidden';
}

//-----------------------------------------------------------------------------
//	tooltip
//-----------------------------------------------------------------------------

function bits(len) { return (1 << len) - 1; }

function getFloat(exponent, mantissa) {
	const exponentBias	= bits(exponent - 1);

	return u => {
		const s = 1 - (u >> (exponent + mantissa)) * 2;
		const e = (u >> mantissa) & bits(exponent);
		const f = (u & bits(mantissa)) / (1 << mantissa);

		return	e === 0					? (2 ** (1 - exponentBias)) * f * s
			:	e === bits(exponent)	? (f ? NaN : s * Infinity)
			:	(2 ** (e - exponentBias)) * (1 + f) * s;
	};
}
const getFloat16	= getFloat(5, 10);
const getBfloat16	= getFloat(8, 7);

function getBigUint(dv, len, littleEndian) {
	let result = 0n;
	if (littleEndian) {
		let offset = len;
		while (offset >= 4) {
			offset -= 4;
			result = (result << 32n) | BigInt(dv.getUint32(offset, true));
		}
		if (len & 2) {
			offset -= 2;
			result = (result << 16n) | BigInt(dv.getUint16(offset, true));
		}
		if (len & 1)
			result |= (result << 8n) | BigInt(dv.getUint8(--offset));
	} else {
		let offset = 0;
		while (offset + 4 <= len) {
			result = (result << 32n) | BigInt(dv.getUint32(offset));
			offset += 4;
		}
		if (len & 2) {
			result = (result << 16n) | BigInt(dv.getUint16(offset));
			offset += 2;
		}
		if (len & 1)
			result |= (result << 8n) | BigInt(dv.getUint8(offset));
	}
	return result;
}

function getBigInt(dv, len, littleEndian) {
	const u = getBigUint(dv, len, littleEndian);
	const s = 1n << BigInt(len * 8);
	return u < s >> 1n ? u : u - s;
}

function getOver(offset) {
	if (offset >= state.selection.a && offset <= state.selection.b)
		return true;//'{"selection": true}';

	for (const h of highlights) {
		if (h.contains(offset))
			return h;//highlights.indexOf(h) + 2;//return '{"highlight": true}';
	}
}


document.addEventListener('mouseenter', event => {
	const span = event.target;
	if (span && span.nodeName === 'SPAN') {
		const offset	= getOffset(span);
		const over		= getOver(offset);
		hexview.dataset.vscodeContext = over ? (over === true ? '{"selection": true}' : '{"highlight": true}') : undefined;

		if (over instanceof Highlight) {
			color_picker.classList.remove('invisible');
			color_picker.style.left	= `${(over.a % num_columns) * hex_width}px`;
			color_picker.style.top	= `${Math.floor(over.a / num_columns) * row_height}px`;
			color_picker.value	= over.color.substring(0, 7);
			current_highlight	= over;
		} else {
			color_picker.classList.add('invisible');
		}

		let tip;
		if (state.selection.a >= 0 && selecting) {
			state.selection.b = offset;
			hex_selection.set(state.selection.a, state.selection.b, num_columns);
			text_selection.set(state.selection.a, state.selection.b, num_columns);
			vscode.setState(state);

			const start 	= Math.min(state.selection.a, state.selection.b), length = Math.abs(state.selection.a - state.selection.b) + 1;
			tip 	= `selection: 0x${start.toString(16)} x ${length}`;

			if (length < 32) {
				const data		= new DataView(chunks[Math.floor(start / chunk_size)].buffer, start % chunk_size);
				const value	= getBigInt(data, length, little_endian);
				tip += `:\ndecimal: ${value}`;

				switch (length) {
					case 2:	tip = tip + `\nfloat16: ${getFloat16(Number(value))}\nbfloat16: ${getBfloat16(Number(value))}`; break;
					case 4:	tip = tip + `\nfloat: ${data.getFloat32(0, little_endian)}`; break;
					case 8:	tip = tip + `\nfloat: ${data.getFloat64(0, little_endian)}`; break;
				}
			}

		} else {
			const byte = chunks[Math.floor(offset / chunk_size)]?.[offset % chunk_size];
			if (byte !== undefined)
				tip = `address: 0x${offset.toString(16)}:\nbinary: 0b${getNumber(byte, 2, 8)}\noctal: 0${getNumber(byte, 8, 3)}\ndecimal: ${byte.toString()}\nhex: 0x${getNumber(byte, 16, 2)}`;
		}

		if (tip) {
			tooltip.style.display = 'block';
			tooltip.style.left	= `${event.pageX + 10}px`;
			tooltip.style.top	= `${event.pageY + 10}px`;
			tooltip.textContent = tip;
			const tooltipRect	= tooltip.getBoundingClientRect();
			if (tooltipRect.right > window.innerWidth)
				tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
		}
	}
}, true);

document.addEventListener('mouseleave', event => {
	tooltip.style.display = 'none';
}, true);

document.addEventListener('mousedown', event => {
	console.log('mousedown!');
	if (event.target.tagName !== 'SPAN')
		return;
	
	if (event.button === 0) {
		state.selection.b = getOffset(event.target);
		if (!event.shiftKey)
			state.selection.a = state.selection.b;

		hex_selection.set(state.selection.a, state.selection.b, num_columns);
		text_selection.set(state.selection.a, state.selection.b, num_columns);
		vscode.setState(state);

		tooltip.style.display = 'none';
		selecting = true;
	}
	vscode.postMessage({command: 'click', offset: getOffset(event.target),  button: event.button});
});

document.addEventListener('mouseup', event => {
	console.log('mouseup!');
	selecting = false;
});

//-----------------------------------------------------------------------------
//	message
//-----------------------------------------------------------------------------

function stringToUint8Array(str) {
    const length = str.length;
    const uint8Array = new Uint8Array(length);
    for (let i = 0; i < length; i++)
        uint8Array[i] = str.charCodeAt(i);
    return uint8Array;
}

function update() {
	const columns = state.columns || calcColumns();
	const y = calcScroll(state.top, columns);
	setActualColumns(columns, y);
	vscroll.setThumb(y);
	hscroll.update();
	fillData(y);
}


window.addEventListener('message', event => {
	//event.stopPropagation();
	const e = event.data;
    switch (e.command) {
		case 'set': {
			if (e.total)
				total = e.total;

			setText(state.text);
			setRadix(state.radix);
			setColumns(state.columns);

			addr_col.textContent = '';
			addr_col.appendChild(document.createElement("div"));	// spacer

			update();

			if (state.selection.a >= 0) {
				hex_selection.set(state.selection.a, state.selection.b, num_columns);
				text_selection.set(state.selection.a, state.selection.b, num_columns);
			}
	
			for (const i of state.highlights) {
				const h = new Highlight(i.a, i.b, i.color);
				h.update(num_columns);
				highlights.push(h);
			}
			break;
		}

		case 'top':
			container.scrollTo({top: calcScroll(e.top, num_columns), behavior: 'smooth'});
			break;

		case 'columns':
			setColumns(state.columns = e.columns);
			vscode.setState(state);
			update();
			break;

		case 'radix': {
			setRadix(state.radix = e.radix);
			vscode.setState(state);

			for (const i in chunks) {
				if (chunks !== 'pending')
					fillHexChunk(hex_divs[i], chunks[i]);
			}

			update();
			break;
		}

		case 'text':
			setText(state.text = e.text);
			vscode.setState(state);
			for (const i in chunks) {
				if (chunks !== 'pending')
					fillTextChunk(text_divs[i], chunks[i]);
			}
			update();
			break;
	
		case 'data': {
			const offset = e.offset / chunk_size;
			const count = e.data.length / chunk_size;
			const data = stringToUint8Array(e.data);
			for (let i = 0; i < count; i++) {
				setTimeout(() => fillChunk(offset + i, data.subarray(i * chunk_size, chunk_size)), 0);
			}
			break;
		}

		case 'getState':
			vscode.postMessage({command: 'state', state});
			break;

		case 'addHighlight': {
			const h = new Highlight(e.a, e.b, e.color);
			h.update(num_columns);
			highlights.push(h);
			state.highlights.push({a: e.a, b: e.b, color: e.color});
			vscode.setState(state);
			break;
		}
		case 'removeHighlight':
			for (const h of highlights) {
				if (h.contains(e.offset)) {
					const i = highlights.indexOf(h);
					h.remove();
					highlights.splice(i, 1);
					state.highlights.splice(i, 1);
					vscode.setState(state);
					break;
				}
			}
			break;
	}
});
