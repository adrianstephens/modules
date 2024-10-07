//const vscode = acquireVsCodeApi();

let sort_column = 0;
let sort_direction = 1;

const table = document.querySelector('table');
const cols  = table.querySelectorAll('th');
let max_path = 0;

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
	const paths = document.querySelectorAll('.path-cell');
	const path_header = cols[paths[0].cellIndex];
	if (max_path == 0) {
		paths.forEach(cell => {
			const dirSpan	   = cell.querySelector('.path-dir');
			const filenameSpan  = cell.querySelector('.path-filename');
			const cellWidth = dirSpan.scrollWidth + filenameSpan.scrollWidth;
			max_path = Math.max(max_path, cellWidth);
		});

		const adj = getMarginAndBorder(path_header);
		max_path += adj.margin.left + adj.margin.right + adj.border.left + adj.border.right;
	}

	const width = document.body.offsetWidth;

	let cellLeft = path_header.offsetLeft;
	let cellWidth = max_path;
	const fudge = 5;

	if (cellLeft + cellWidth + fudge > width) {
		cellWidth = width - cellLeft - fudge;
  
		paths.forEach(cell => {
			const dirSpan	   = cell.querySelector('.path-dir');
			const filenameSpan  = cell.querySelector('.path-filename');

			cell.style.width = cell.style.maxWidth = `${cellWidth}px`;

			const filenameWidth = filenameSpan.getBoundingClientRect().width;
			filenameSpan.style.maxWidth = `${filenameWidth}px`;
			dirSpan.style.maxWidth	  = `${Math.max(cellWidth - filenameWidth - fudge, 0)}px`;
		});
	}
}

// Run on load and resize
window.addEventListener('load', adjustPathWidths);
window.addEventListener('resize', adjustPathWidths);
const resizeObserver = new ResizeObserver(entries => {
	adjustPathWidths();
});

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

	const tbody = table.querySelector('tbody');
	const rows = Array.from(tbody.querySelectorAll('tr'));

	rows.sort((a, b) => {
		let aValue = a.childNodes[column].textContent.toUpperCase();
		let bValue = b.childNodes[column].textContent.toUpperCase();
		return (aValue < bValue ? -1 : aValue > bValue ? 1 : 0) * sort_direction;
	});

	tbody.innerHTML = '';
	rows.forEach(row => tbody.appendChild(row));
}

cols.forEach((header,i) => {
	if (i !== 3)
		resizeObserver.observe(header);
	header.addEventListener('click', e => {
		sortTable(i);
	});
});

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
	}
});
