let sort_column = -1;
let sort_direction = 1;

const table 	= document.querySelector('table');
const cols  	= table.querySelectorAll('th');

const vscroll 	= new ScrollBar(document.body, document.documentElement, false);
const hscroll 	= new ScrollBar(document.body, document.documentElement, true);

window.addEventListener('resize', () => {
	vscroll.update();
	hscroll.update();
});
window.addEventListener("scroll", () => {
	vscroll.update();
});

function initPathWidths() {
	const paths = document.querySelectorAll('td.path');
	const widths = Array.from(paths, cell => cell.lastElementChild.offsetWidth);

	paths.forEach((cell, i) => {
		cell.firstElementChild.style.maxWidth = `calc(100% - ${widths[i] + 5}px)`;
		cell.lastElementChild.style.maxWidth = '100%';
	});
}

function replace(text, re, process) {
	let i = 0;
	let result = '';
	for (let m; (m = re.exec(text)); i = re.lastIndex)
		result += text.substring(i, m.index) + process(m);
	return result + text.substring(i);
}

function replace_in_element(e, re, process) {
	if (e.id)
		e.id = replace(e.id, re, process);
	if (e.attributes.name)
		e.attributes.name.value = replace(e.attributes.name.value, re, process);
	const childNodes = e.childNodes;
	for (let i = 0; i < childNodes.length; i++) {
		const node = childNodes[i];
		if (node.nodeType === window.Node.TEXT_NODE)
			node.textContent = replace(node.textContent, re, process);
		else if (node.nodeType === window.Node.ELEMENT_NODE)
			replace_in_element(node, re, process);
	}
}

function template(template, parent, values) {
	const newnodes = values.map(i => {
		const child = template.cloneNode(true);
		child.hidden = false;
		replace_in_element(child, /\$\((.*)\)/g, m => i[m[1]]);
		return child;
	});

//	const parent = after.parentNode;
//	const before = after.nextSibling;
	const before = null;
	for (const i of newnodes)
		parent.insertBefore(i, before);
}

function debounce(func, wait) {
	let timeout;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = null;
			func(...args);
		}, wait);
	};
}

function getEdges(left, right, top, bottom) {
	[left, right, top, bottom] = [left, right, top, bottom].map(f => parseFloat(f) || 0);
	return {left, right, top, bottom};
}

function getPadding(style) {
	return getEdges(
		style.paddingLeft,
		style.paddingRight,
		style.paddingTop,
		style.paddingBottom
	);
}
function getMargin(style) {
	return getEdges(
		style.marginLeft,
		style.marginRight,
		style.marginTop,
		style.marginBottom
	);
}
function getBorder(style) {
	return getEdges(
		style.borderLeftWidth,
		style.borderRightWidth,
		style.borderTopWidth,
		style.borderBottomWidth
	);
}

function getMarginAndBorder(element) {
	const style = window.getComputedStyle(element);
	return {
		margin: getMargin(style),
		border: getBorder(style)
	};
}

function adjustPathWidths() {
	const paths = document.querySelectorAll('td.path');
	const cellWidth = document.body.clientWidth - (paths[0].offsetLeft + 5);
	paths.forEach((cell, i) => {
		cell.style.maxWidth = `${cellWidth}px`;
	});
}

//cols[0].classList.add('sort');
initPathWidths();

const resizeObserver = new ResizeObserver(entries => adjustPathWidths());
resizeObserver.observe(document.documentElement);

function sortTable(column) {
	if (column === sort_column) {
		sort_direction = -sort_direction;
		cols[column].classList.toggle("up");

	} else {
		if (sort_column >= 0)
			cols[sort_column].classList.remove("sort");
		sort_column = column;
		cols[sort_column].classList.add("sort");
		sort_direction = 1;
	}

	const type = cols[column].dataset.type;

	const tbody = table.querySelector('tbody');
	const rows	= Array.from(tbody.querySelectorAll('tr'));

	const compare	= type === 'number'
		? (a, b) => parseInt(a) - parseInt(b)
		: (a, b) => a.localeCompare(b);

	rows.sort((a, b) => compare(a.childNodes[column].textContent, b.childNodes[column].textContent) * sort_direction);

	tbody.innerHTML = '';
	rows.forEach(row => tbody.appendChild(row));
}

cols.forEach((header,i) => {
	//if (header.dataset.type !== 'path')
	//	resizeObserver.observe(header);
	header.addEventListener('click', e => {
		sortTable(i);
	});
});

table.querySelectorAll('tbody tr').forEach(row => row.addEventListener('click', event =>
	vscode.postMessage({
		command: event.target.matches('tr') ? 'click' : 'select',
		id: row.id
	})
));

table.querySelectorAll('td.path').forEach(path => path.addEventListener('click', event =>
	vscode.postMessage({
		command: 'open',
		path: path.getAttribute("title")
	})
));


window.addEventListener('message', event => {
	switch (event.data.command) {
		case 'set_text': {
			const element = document.getElementById(event.data.id);
			if (element)
				element.textContent = event.data.value;
			else
				console.log("didn't find" + event.data.id);
			break;
		}

		case 'add_class':
			document.querySelectorAll(event.data.selector).forEach(i => {
				if (event.data.enable)
					i.classList.add(event.data.class);
				else
					i.classList.remove(event.data.class);
			});
			break;

		case 'add_item': {
			const t = document.getElementById(event.data.template);
			const d = document.getElementById(event.data.dest);

			template(t, d, event.data.values);
			hscroll.update();
		}

	}
});
