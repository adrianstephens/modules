const state			= {top:0, total_rows: 0, ...vscode.getState()};
const root			= document.getElementById('root');
const row_height	= 20;
const rows			= [];

const scroll_container = {
	clientOffset: 		0,
	get clientSize()	{ return window.innerHeight / row_height; },
	get clientPixels() 	{ return window.innerHeight; },
	scrollOffset:		state.top,
	get scrollSize()	{ return state.total_rows; },
	set scrollSize(x)	{
		state.total_rows = x;
		vscode.setState(state);
		const b = this.getBase();
		root.style.height = Math.min(x - b, 2048) * row_height + 'px';
	},
	setScroll(x)		{
		this.scrollOffset = x;
		state.top = x;
		vscode.setState(state);

		const b = this.getBase();
		document.documentElement.scrollTop = (x - b) * row_height;
		root.style.height = Math.min(state.total_rows - b, 2048) * row_height + 'px';
	},
	getBase() {
		const b = this.scrollOffset & -256;
		return b ? b - 256 : b;
	}
}

scroll_container.setScroll(state.top);
const vscroll 		= new ScrollBar(document.body, scroll_container, false);

document.addEventListener('DOMContentLoaded', () => {
	vscode.postMessage({command: 'ready'});
	vscroll.update();
});

const row_pool	= new Pool(() => {
	const div	= createElement("div", {className:"instruction"});
	div.appendChild(createElement("span"));
	div.appendChild(createElement("span"));
	div.appendChild(createElement("span"));
	div.appendChild(createElement("span"));
	return div;
});

const label_pool	= new Pool(() => {
	const div	= createElement("div", {className:"label"});
	return div;
});

function fill(y) {
	const top 		= Math.floor(y);
	const bottom	= top + Math.ceil(window.innerHeight / row_height);

	const a = top & -64, b = (bottom + 63) & -64;

	for (const i in rows) {
		if (i < a || i > b) {
			if (rows[i]) {
				const pool = rows[i].className === 'instruction' ? row_pool : label_pool;
				pool.discardElement(rows[i]);
				delete rows[i];
			}
		}
	}

	const base = scroll_container.getBase();

	let get0, get1;
	for (let i = a; i < b; i++) {
		if (!rows[i]) {
			if (get0 === undefined)
				get0 = i;
			get1 = i;
			
			const row = row_pool.get();
			rows[i] = row;
			row.style.gridRow = i - base + 1;
			row.children[0].textContent = 'loading...';
			row.children[1].textContent = '';
			row.children[2].textContent = '';
			row.children[3].textContent = '';
			root.appendChild(row);
		} else {
			rows[i].style.gridRow = i - base + 1;
		}
	}
	if (get0 !== undefined)
		vscode.postMessage({command: 'request', offset: get0, count: get1 - get0 + 1});
}

/*
window.addEventListener('wheel', e => {
	e.preventDefault();
	const maxTop = scroll_container.scrollSize - scroll_container.clientSize;
	scroll_container.setScroll(Math.max(0, Math.min(scroll_container.scrollOffset + e.deltaY, maxTop)));
	vscroll.update();
}, {passive: false});
*/

window.addEventListener("scroll", event => {
	const y = document.documentElement.scrollTop / row_height;
	const b = scroll_container.getBase();

	vscroll.setScroll(b + y);
	fill(b + y);
/*
	scroll_container.setScroll(b + y);

	if (y > 256)
		document.documentElement.scrollTop -= 256 * row_height;

	vscroll.update();
	*/
});


window.addEventListener('message', event => {
	const e = event.data;
	switch (e.command) {
		case 'total':
			scroll_container.scrollSize = e.total;
			break;

		case 'instructions': {
			let offset = e.offset;
			for (const i of e.instructions) {
				if (i.symbol) {
					let row = rows[offset];
					if (row) {
						if (row.className === 'instruction') {
							row_pool.discardElement(row);
							const gridRow = row.style.gridRow;
							row = label_pool.get();
							row.style.gridRow = gridRow;
							rows[offset] = row;
							root.appendChild(row);
						}
						row.textContent = i.symbol;
					}
					++offset;
				}
				const row = rows[offset++];
				if (row) {
					row.children[0].textContent = i.address;
					row.children[1].textContent = i.instructionBytes;
					row.children[2].textContent = i.instruction;
				}
			}
			break;
		}
	}
});


fill(0);