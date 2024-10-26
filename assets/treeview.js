const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => vscode.postMessage({command: 'ready'}));

//function evaluate(expression) {
//	if (expression.startsWith('calc('))
//		return Function('const calc = (a)=>a; return ' + expression)();
//	return expression;
//}

document.querySelectorAll('.caret').forEach(caret => {
	caret.addEventListener('click', event => {
		caret.classList.toggle('caret-down');
		event.stopPropagation();
	});
});

function isStuck(e) {
	if (!e || getComputedStyle(e).getPropertyValue('position') != 'sticky')
		return false;
	const bottom = e.getBoundingClientRect().bottom;
	return e.nextElementSibling.getBoundingClientRect().top < bottom;
}

let prev_stuck;
document.addEventListener("scroll", event => {
	let i = 0;
	let last_stuck;
	for(;;) {
		const e = document.elementFromPoint(i * 20 + 70, i * 20 + 10);
		if (!isStuck(e))
			break;
		last_stuck = e;
		++i;
	}

	if (last_stuck !== prev_stuck) {
		if (prev_stuck)
			prev_stuck.classList.remove('stuck');

		if (last_stuck)
			last_stuck.classList.add('stuck');

		prev_stuck = last_stuck
	}
	console.log('sticky depth=', i)
});
/*
document.querySelectorAll('.children > div').forEach(item => {
	item.addEventListener('click', event => {
		vscode.postMessage({
			command: 'click',
			id: event.target?.textContent
		})
		event.stopPropagation();
	});
});
*/
document.querySelectorAll('.binary').forEach(item => {
	item.addEventListener('click', event => {
		vscode.postMessage({
			command: 'binary',
			offset: event.target?.dataset.offset,
			length: event.target?.dataset.length,
		})
		event.stopPropagation();
	});
});
