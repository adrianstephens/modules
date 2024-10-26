const vscode = acquireVsCodeApi();

const container		= document.querySelector('.container');
const hexview		= document.querySelector('.hexview');
const addr_col		= document.querySelector('.addr');
const hex_col		= document.querySelector('.hex');
const ascii_col		= document.querySelector('.ascii');
const tooltip 		= makeDivClass('tooltip');

const body_style	= getComputedStyle(document.body);

const row_height	= parseInt(body_style.getPropertyValue('--row-height'));
const digit_width	= parseInt(body_style.getPropertyValue('--digit-width'));
const chunk_size	= 1024;
const state			= [];
const hex_divs		= [];
const ascii_divs	= [];
const addr_divs		= [];
const blocks		= [];

let hex_width		= digit_width * 2;
let num_digits		= 2;
let total			= 0;
let num_columns		= 0;
let current_radix	= 16;
let current_signed	= false;
let little_endian	= true;
let auto_columns	= false;
let filling 		= false;
let last_top		= 0;
let selection_a		= -1;
let selection_b		= -1;

function makeDivClass(className) {
	const div = document.createElement("div");
	div.className = className;
	return div;
}

class ScrollBar {
	thumb_size;

	constructor(parent, container, horizontal) {
		const thumb 	= makeDivClass(horizontal ? 'hscrollbar' : 'vscrollbar');
		parent.appendChild(thumb);

		this.thumb		= thumb;
		this.container	= container;
		this.horizontal = horizontal;

		thumb.addEventListener('mousedown', event => {
			const mouseOffset 	= horizontal ? thumb.offsetLeft - event.clientX : thumb.offsetTop - event.clientY;
			thumb.classList.add('active');

			const onMouseMove = event => {
				this.setThumbPixel(mouseOffset + (horizontal ? event.clientX : event.clientY));
			};
	
			const onMouseUp = () => {
				thumb.classList.remove('active');
				document.removeEventListener('mousemove',	onMouseMove);
				document.removeEventListener('mouseup',		onMouseUp);
			};

			document.addEventListener('mousemove',	onMouseMove);
			document.addEventListener('mouseup', 	onMouseUp);
		});
	}

	get sizes() {
		const client = this.container.getBoundingClientRect();
		return this.horizontal
			? [this.container.clientWidth, this.container.scrollWidth, client.left]
			: [this.container.clientHeight, this.container.scrollHeight, client.top];
	}

	update() {
		this.setThumb(this.horizontal ? this.container.scrollLeft : this.container.scrollTop);
	}

	setThumbSize(size) {
		if (size != this.thumb_size) {
			this.thumb_size = size;
			if (this.horizontal)
				this.thumb.style.width 	= `${size}px`;
			else
				this.thumb.style.height = `${size}px`;
		}
	}
	
	setThumb(scroll) {
		const [window_size, total_size, offset]	= this.sizes;
		let thumb_pos, thumb_size;
	
		if (window_size >= total_size) {
			this.thumb.classList.add('invisible');
			thumb_size	= total_size;
			thumb_pos	= offset;
		} else {
			this.thumb.classList.remove('invisible');
			thumb_size	= Math.max(window_size * window_size / total_size, 20);
			thumb_pos	= offset + scroll * (window_size - thumb_size) / (total_size - window_size);
		}

		this.setThumbSize(thumb_size);

		if (this.horizontal)
			this.thumb.style.left 	= `${thumb_pos}px`;
		else
			this.thumb.style.top 	= `${thumb_pos}px`;
	}
	
	setThumbPixel(pos) {
		const [window_size, total_size, offset]	= this.sizes;
		const thumb_pos		= Math.min(Math.max(pos, offset), offset + window_size - this.thumb_size);
		const scroll		= (thumb_pos - offset) * (total_size - window_size) / (window_size - this.thumb_size);

		if (this.horizontal) {
			this.thumb.style.left		= `${thumb_pos}px`;
			this.container.scrollLeft	= scroll;
		} else {
			this.thumb.style.top 		= `${thumb_pos}px`;
			this.container.scrollTop	= scroll;
		}
	}
}

class Selection {
	constructor(parent) {
		this.selection = makeDivClass('selection');
		parent.appendChild(this.selection);
	}

	set(a, b, num_columns) {
		if (a > b) {
			const t = a;
			a = b;
			b = t;
		}
		++b;
	
		const selection = this.selection;
		const startY = Math.floor(a / num_columns);
		const endY = Math.floor(b / num_columns);
		selection.setAttribute('data-multi-row', startY != endY);
	
		selection.style.setProperty('--start-x', a % num_columns);
		selection.style.setProperty('--start-y', startY);
		selection.style.setProperty('--end-x', b % num_columns);
		selection.style.setProperty('--end-y', endY);
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
const ascii_spacer	= new Spacer2D(ascii_col);
const vscroll 		= new ScrollBar(document.body, container, false);
const hscroll 		= new ScrollBar(hex_col, hex_col, true);
const hex_selection		= new Selection(hex_col);
const ascii_selection	= new Selection(ascii_col);

document.addEventListener('DOMContentLoaded', () => {
	document.body.appendChild(tooltip);
	addr_col.textContent = '00000000';
	vscode.postMessage({command: 'ready'});
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

function insertBlock(i, col, divs) {
	const block	= getBlock();
	block.chunk = i;
	divs[i]		= block;

	let before = divs[i + 1];
	if (!before && divs[i - 1])
		before = divs[i - 1].nextSibling;
	col.insertBefore(block, before);
	return block;
}

//-----------------------------------------------------------------------------
//	scroll
//-----------------------------------------------------------------------------

function requestChunk(i) {
	if (!state[i]) {
		state[i] = 'pending';

		insertBlock(i, hex_col, hex_divs).className = 'placeholder';
		insertBlock(i, ascii_col, ascii_divs).className = 'placeholder';
		vscode.postMessage({
			command: 'load',
			offset: i * chunk_size,
			length: chunk_size
		});
/*
		setTimeout(()=> 
			vscode.postMessage({
			command: 'load',
			offset: i * chunk_size,
			length: chunk_size
		}), 0);
		*/
	}
}

function fillChunk(chunk, data, offset) {
	if (state[chunk] !== 'pending') {
		console.log("fillChunk: invalid state", state[chunk]);
	}
	if (state[chunk] === 'pending') {
		const hex	= hex_divs[chunk];
		const ascii	= ascii_divs[chunk];
		const size	= Math.min(chunk_size, data.length - offset);

		for (let k = 0; k < size; k++) {
			const byte = data[offset + k];
			hex.children[k].textContent		= getValueString(byte);
			ascii.children[k].textContent	= byte > 32 && byte < 127 ? String.fromCharCode(byte) : '.';
		}
		for (let k = size; k < chunk_size; k++) {
			hex.children[k].textContent		= '';
			ascii.children[k].textContent	= '';
		}

		hex.className	= 'data';
		ascii.className	= 'data';
//		state[chunk] 	= 'loaded';
		state[chunk] 	= data.subarray(offset, size);
	}
}

function fillData(y) {
//	hex_col.style.height = `${window.innerHeight - hexview.getBoundingClientRect().top}px`;

	const rows		= Math.ceil(total / num_columns);
	const top 		= Math.min(Math.floor(y / row_height), rows);
	const bottom	= Math.min(Math.ceil((y + window.innerHeight) / row_height), rows);

	const top_addr	= top * num_columns;
	if (top_addr !== last_top) {
		last_top	= top_addr;
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
			const addr = insertBlock(i, addr_col, addr_divs);
			addr.className = 'data';
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

	for (const i in state) {
		if (i < a || i >= b) {
		//if (i < a1 || i >= b1) {
			hex_col.removeChild(hex_divs[i]);
			ascii_col.removeChild(ascii_divs[i]);
			discardBlock(hex_divs[i]);
			discardBlock(ascii_divs[i]);
			delete hex_divs[i];
			delete ascii_divs[i];
			delete state[i];
		}
	}

	hex_spacer.set(a * chunk_size, num_columns);
	ascii_spacer.set(a * chunk_size, num_columns);

	for (let i = a; i < b; i++)
		requestChunk(i);
/*
	if (filling) {
		console.log('already filling');
	} else {
		filling = true;
		setTimeout(() => {
			for (let i = a1; i < a; ++i)
				requestChunk(i, changed_cols);
			for (let i = b; i < b1; ++i)
				requestChunk(b, changed_cols);
			filling = false;
		}, 0);
	}
*/
}

/*
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
*/

container.addEventListener("scroll", event => {
	const y	= container.scrollTop;
	vscroll.setThumb(y);
	fillData(y);
});
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

	if (selection_a >= 0) {
		hex_selection.set(selection_a, selection_b, num_columns);
		ascii_selection.set(selection_a, selection_b, num_columns);
	}

	//remove all address blocks

	for (const i in addr_divs) {
		addr_col.removeChild(addr_divs[i]);
		discardBlock(addr_divs[i]);
		delete addr_divs[i];
	}

	container.scrollTop = y;
}

window.addEventListener('resize', () => {
	const columns	= auto_columns ? calcColumns() : num_columns;
	const y			= calcScroll(last_top, columns);
	if (columns != num_columns)
		setActualColumns(columns, y);
	vscroll.setThumb(y);
	fillData(y);
	hscroll.update();
});

function setColumns(columns) {
	if (auto_columns) {
		if (columns) {
			auto_columns = false;
			hex_col.style.overflowX = 'visible';
		}
	} else if (columns === 0) {
		auto_columns = true;
		hex_col.style.overflowX = 'hidden';
	}
	return columns || calcColumns();
}

//-----------------------------------------------------------------------------
//	radix
//-----------------------------------------------------------------------------


function getValueString(byte) {
	return current_signed && byte >= 128
		? '-' + (256 - byte).toString(current_radix).padStart(num_digits, '0')
		: byte.toString(current_radix).padStart(num_digits, '0');
}

function setRadix(radix, signed) {
	current_radix	= radix;
	current_signed	= signed;
	num_digits		= radix == 2 ? 8 : radix < 16 ? 3 : 2;
	const digits	= num_digits + (signed ? 1 : 0);
	hex_width		= digits * digit_width;
	document.body.style.setProperty('--digits', digits.toString());

	for (const i in state) {
		if (state !== 'pending') {
			const block	= hex_divs[i];
			const data	= state[i];
			for (let k = 0; k < data.length; k++)
				block.children[k].textContent = getValueString(data[k]);
		}
	}
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
	const u = getBigUint(dv, len, true);
	const s = 1n << BigInt(len * 8);
	return u < s >> 1n ? u : u - s;
}

document.addEventListener('mouseenter', event => {
	const span = event.target;
	if (span && span.nodeName === 'SPAN') {
		const offset	= getOffset(span);

		if (offset >= selection_a && offset <= selection_b) {
			hexview.dataset.vscodeContext = '{"selection": true}';
		} else {
			delete hexview.dataset.vscodeContext;
		}

		let tip;
		if (selection_a >= 0 && (event.buttons & 1)) {
			selection_b = offset;
			hex_selection.set(selection_a, selection_b, num_columns);
			ascii_selection.set(selection_a, selection_b, num_columns);

			const start 	= Math.min(selection_a, selection_b), length = Math.abs(selection_a - selection_b) + 1;
			tip 	= `0x${start.toString(16)} x ${length}`;

			if (length < 32) {
				const data		= new DataView(state[Math.floor(start / chunk_size)].buffer, start % chunk_size);
				const value	= getBigInt(data, length, little_endian);
				tip += `:\ndecimal: ${value}`;

				switch (length) {
					case 2:	tip = tip + `\nfloat16: ${getFloat16(Number(value))}\nbfloat16: ${getBfloat16(Number(value))}`; break;
					case 4:	tip = tip + `\nfloat: ${data.getFloat32(0, little_endian)}`; break;
					case 8:	tip = tip + `\nfloat: ${data.getFloat64(0, little_endian)}`; break;
				}
			}

		} else {
			const byte = state[Math.floor(offset / chunk_size)][offset % chunk_size];
			if (byte !== undefined)
				tip = `0x${offset.toString(16)}:\nbinary: ${byte.toString(2).padStart(8, '0')}\noctal: ${byte.toString(8).padStart(3, '0')}\ndecimal: ${byte.toString()}`;
		}

		if (tip) {
			tooltip.style.display = 'block';
			tooltip.style.left = `${event.pageX + 10}px`;
			tooltip.style.top = `${event.pageY + 10}px`;
			tooltip.textContent = text;
			const tooltipRect = tooltip.getBoundingClientRect();
			if (tooltipRect.right > window.innerWidth)
				tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
		}
	}
}, true);

document.addEventListener('mouseleave', event => {
	tooltip.style.display = 'none';
}, true);

document.addEventListener('mousedown', event => {
	if (event.button === 0) {
		selection_b = getOffset(event.target);
		if (!event.shiftKey)
			selection_a = selection_b;

		hex_selection.set(selection_a, selection_b, num_columns);
		ascii_selection.set(selection_a, selection_b, num_columns);

		tooltip.style.display = 'none';
	}
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

window.addEventListener('message', event => {
	//event.stopPropagation();
	const e = event.data;
    switch (e.command) {
		case 'set': {
			if (e.total)
				total = e.total;

			if (e.radix)
				setRadix(e.radix, e.signed);

			const columns = setColumns(e.columns);

			addr_col.textContent = '';
			addr_col.appendChild(document.createElement("div"));	// spacer

			const y = calcScroll(e.top, columns);
			setActualColumns(columns, y);
			vscroll.setThumb(y);
			fillData(y);
			break;
		}

		case 'columns': {
			const columns = setColumns(e.columns);
			const y	= calcScroll(last_top, columns);
			setActualColumns(columns, y);
			vscroll.setThumb(y);
			fillData(y);
			break;
		}

		case 'radix': {
			setRadix(e.radix, e.signed);
			break;
		}

		case 'data': {
			const offset = e.offset / chunk_size;
			const count = e.data.length / chunk_size;
			const data = stringToUint8Array(e.data);
			for (let i = 0; i < count; i++) {
				setTimeout(() => fillChunk(offset + i, data, i * chunk_size), 0);
			}
			break;
		}

		case 'getSelection': {
			vscode.postMessage({command: 'selection', a:selection_a, b:selection_b});
			break;
		}

	}
});
