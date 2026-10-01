export function initUI() {
	const navItems = document.querySelectorAll('.nav-item');
	navItems.forEach(item => {
		item.addEventListener('click', (e) => {
			e.preventDefault();
			navItems.forEach(nav => nav.classList.remove('active'));
			item.classList.add('active');
			const name = item.getAttribute('data-name') || '概览';
			const panelName = item.getAttribute('data-panel') || 'overview';
			const titleEl = document.querySelector('.page-title');
			if (titleEl) titleEl.textContent = name;

			const panels = document.querySelectorAll('.view-panel');
			const targetPanel = document.querySelector(`.view-panel[data-panel="${panelName}"]`);
			if (targetPanel) {
				panels.forEach(panel => panel.classList.add('hidden'));
				targetPanel.classList.remove('hidden');
			}
		});
	});

	const statusToggle = document.getElementById('status-toggle');
	const statusPanel = document.getElementById('status-panel');
	const colorToggle = document.getElementById('color-toggle');
	const colorPanel = document.getElementById('color-panel');
	const bgToggle = document.getElementById('bg-toggle');
	const bgPanel = document.getElementById('bg-panel');

	function closeAllPanels(except = '') {
		if (except !== 'status') statusPanel?.classList.add('hidden');
		if (except !== 'color') colorPanel?.classList.add('hidden');
		if (except !== 'bg') bgPanel?.classList.add('hidden');
	}

	statusToggle?.addEventListener('click', (e) => {
		e.stopPropagation();
		closeAllPanels('status');
		statusPanel?.classList.toggle('hidden');
	});
	colorToggle?.addEventListener('click', (e) => {
		e.stopPropagation();
		closeAllPanels('color');
		colorPanel?.classList.toggle('hidden');
		document.dispatchEvent(new CustomEvent('color-panel-opened'));
	});
	bgToggle?.addEventListener('click', (e) => {
		e.stopPropagation();
		closeAllPanels('bg');
		bgPanel?.classList.toggle('hidden');
		document.dispatchEvent(new CustomEvent('bg-panel-opened'));
	});

	document.addEventListener('click', () => closeAllPanels());
	statusPanel?.addEventListener('click', (e) => e.stopPropagation());
	colorPanel?.addEventListener('click', (e) => e.stopPropagation());
	bgPanel?.addEventListener('click', (e) => e.stopPropagation());

	const toggleChatBtn = document.getElementById('toggle-chat-btn');
	const chatHistoryEl = document.getElementById('chat-history');
	toggleChatBtn?.addEventListener('click', () => {
		chatHistoryEl?.classList.toggle('hidden');
		if (chatHistoryEl?.classList.contains('hidden')) {
			toggleChatBtn.textContent = '显示会话';
		} else {
			toggleChatBtn.textContent = '隐藏会话';
		}
	});
}