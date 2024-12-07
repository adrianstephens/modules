const state			= vscode.getState() || {};
const vscroll 		= new ScrollBar(document.body, document.documentElement, false);
const tree			= new Tree(document.querySelector('.tree'), (element, open) => {
	if (open) {
		state.open.push(generateSelector(element));
	} else {
		const index = state.open.indexOf(generateSelector(element));
		if (index !== -1)
			state.open.splice(index, 1);
	}
	vscode.setState(state);
});

document.addEventListener('DOMContentLoaded', () => {
	vscode.postMessage({command: 'ready'});

	if (state.open) {
		tree.close_all();
		state.open.forEach(id => tree.open(document.querySelector(id)));
	} else {
		state.open = tree.all_open();
		vscode.setState(state);
	}
});

document.addEventListener("scroll", event => {
	vscroll.update();
	updateStuck();
});

document.querySelectorAll('.select').forEach(item => {
	item.addEventListener('click', event => {
		vscode.postMessage({
			command: 'select',
			selector: generateSelector(item),
			text: item.textContent,
			...item.dataset
		})
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

		case 'scroll_to':
			reveal(document.querySelector(event.data.selector));
			break;

	}
});