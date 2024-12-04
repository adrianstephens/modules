const state			= vscode.getState() || {};
const vscroll 		= new ScrollBar(document.body, document.documentElement, false);

document.addEventListener('DOMContentLoaded', () => {
	vscode.postMessage({command: 'ready'});

	const elements = document.getElementsByClassName('caret-down');
	if (state?.open) {
		Array.from(elements).forEach(e => e.classList.remove('caret-down'));
		state.open.forEach(id => document.querySelector(id)?.classList.add('caret-down'));
	} else {
		state.open = Array.from(elements, element => generateSelector(element));
		vscode.setState(state);
	}
});

//function evaluate(expression) {
//	if (expression.startsWith('calc('))
//		return Function('const calc = (a)=>a; return ' + expression)();
//	return expression;
//}

document.querySelectorAll('.caret').forEach(caret => {
	caret.addEventListener('click', event => {
		if (event.target.parentElement !== caret || window.getSelection().toString().length > 0)
			return;

		caret.classList.toggle('caret-down');
		if (caret.classList.contains('caret-down')) {
			state.open.push(generateSelector(caret));
		} else {
			const index = state.open.indexOf(generateSelector(caret));
			if (index !== -1)
				state.open.splice(index, 1);
		}
		vscode.setState(state);
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
	vscroll.update();
	const x = document.querySelector('.tree').clientWidth - 20;
	
	let i = 0;
	let last_stuck;
	for(;;) {
		const e = document.elementFromPoint(x, i * 22 + 10);
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

document.querySelectorAll('.binary').forEach(item => {
	item.addEventListener('click', event => {
		vscode.postMessage({
			command: 'binary',
			name: getFirstText(item),
			...item.dataset
		})
		event.stopPropagation();
	});
});
*/
document.querySelectorAll('.select').forEach(item => {
	item.addEventListener('click', event => {
		vscode.postMessage({
			command: 'select',
			selector: generateSelector(item),
			path: item.textContent,
			...item.dataset
		})
		event.stopPropagation();
	});
});

document.querySelectorAll('.dllentry').forEach(item => {
	item.addEventListener('click', event => {
		//const test = item.closest('has(.path)');
		const dll = item.parentNode.parentNode.querySelector('.select').textContent;
		vscode.postMessage({
			command: 'dllentry',
			path: dll,
			entry: item.textContent
		});
		event.stopPropagation();
	});
});

window.addEventListener('message', event => {
	const e = event.data;
    switch (e.command) {
		case 'add_class':
			document.querySelectorAll(event.data.selector).forEach(i => {
				if (event.data.enable)
					i.classList.add(event.data.class);
				else
					i.classList.remove(event.data.class);
			});
			break;

		case 'scroll_to': {
			const element = document.querySelector(event.data.selector);
			if (element) {
				for (let parent = element.parentNode; parent; parent = parent.parentNode) {
					if (parent.classList?.contains('caret'))
						parent.classList.add('caret-down');
				}
				element.scrollIntoView({behavior: 'smooth', block: 'center'});
			}
			break;
		}

	}
});