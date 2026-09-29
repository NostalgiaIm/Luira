const DEFAULT_COLORS = {
	bot: '#f3f4f6',
	user: '#3b82f6',
	botText: '#1f2937',
	userText: '#ffffff',
	accent: '#3b82f6'
};

// 把 #3b82f6 转成 rgb 分量
function hexToRgb(hex: string) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return { r, g, b };
}

// 👈 核心：应用强调色时，同时派生「深色边线 + 浅色背景 + 悬停色」
function applyAccentColor(hex: string) {
	const { r, g, b } = hexToRgb(hex);
	document.body.style.setProperty('--accent-color', hex);
	document.body.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.15)`);
	document.body.style.setProperty('--accent-bg-hover', `rgba(${r}, ${g}, ${b}, 0.25)`);
	document.body.style.setProperty('--accent-text', hex);
}

export function initColors() {
	const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
	const targetBtns = document.querySelectorAll('.target-btn');
	let currentTarget = 'bot';
	let openingColors = { bot: '', user: '', botText: '', userText: '', accent: '' };

	function applyColor(target: string, bgColor: string, textColor: string) {
		if (target === 'bot') {
			document.body.style.setProperty('--bot-bubble-bg', bgColor);
			document.body.style.setProperty('--bot-bubble-text', textColor);
		} else if (target === 'user') {
			document.body.style.setProperty('--user-bubble-bg', bgColor);
			document.body.style.setProperty('--user-bubble-text', textColor);
		} else if (target === 'accent') {
			applyAccentColor(bgColor);
		}
	}

	function getContrastColor(hexcolor: string) {
		const r = parseInt(hexcolor.slice(1, 3), 16);
		const g = parseInt(hexcolor.slice(3, 5), 16);
		const b = parseInt(hexcolor.slice(5, 7), 16);
		const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
		return (yiq >= 128) ? '#1f2937' : '#ffffff';
	}

	function getCurrentColors(target: string) {
		if (target === 'bot') {
			return { bg: localStorage.getItem('botBubbleColor') || DEFAULT_COLORS.bot, text: localStorage.getItem('botTextColor') || DEFAULT_COLORS.botText };
		} else if (target === 'user') {
			return { bg: localStorage.getItem('userBubbleColor') || DEFAULT_COLORS.user, text: localStorage.getItem('userTextColor') || DEFAULT_COLORS.userText };
		} else {
			return { bg: localStorage.getItem('accentColor') || DEFAULT_COLORS.accent, text: DEFAULT_COLORS.accent };
		}
	}

	function initColorsFromStorage() {
		applyColor('bot', localStorage.getItem('botBubbleColor') || DEFAULT_COLORS.bot, localStorage.getItem('botTextColor') || DEFAULT_COLORS.botText);
		applyColor('user', localStorage.getItem('userBubbleColor') || DEFAULT_COLORS.user, localStorage.getItem('userTextColor') || DEFAULT_COLORS.userText);
		applyColor('accent', localStorage.getItem('accentColor') || DEFAULT_COLORS.accent, DEFAULT_COLORS.accent);
	}

	function onPanelOpen() {
		openingColors = {
			bot: document.body.style.getPropertyValue('--bot-bubble-bg') || DEFAULT_COLORS.bot,
			user: document.body.style.getPropertyValue('--user-bubble-bg') || DEFAULT_COLORS.user,
			botText: document.body.style.getPropertyValue('--bot-bubble-text') || DEFAULT_COLORS.botText,
			userText: document.body.style.getPropertyValue('--user-bubble-text') || DEFAULT_COLORS.userText,
			accent: document.body.style.getPropertyValue('--accent-color') || DEFAULT_COLORS.accent
		};
		const current = getCurrentColors(currentTarget);
		colorPicker.value = current.bg;
	}

	targetBtns.forEach(btn => {
		btn.addEventListener('click', () => {
			targetBtns.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			currentTarget = btn.getAttribute('data-target') || 'bot';
			const current = getCurrentColors(currentTarget);
			colorPicker.value = current.bg;
		});
	});

	colorPicker.addEventListener('input', () => {
		const newBg = colorPicker.value;
		const newText = getContrastColor(newBg);
		applyColor(currentTarget, newBg, newText);
	});

	document.getElementById('color-save')?.addEventListener('click', () => {
		const newBg = colorPicker.value;
		const newText = getContrastColor(newBg);
		if (currentTarget === 'bot') {
			localStorage.setItem('botBubbleColor', newBg);
			localStorage.setItem('botTextColor', newText);
		} else if (currentTarget === 'user') {
			localStorage.setItem('userBubbleColor', newBg);
			localStorage.setItem('userTextColor', newText);
		} else {
			localStorage.setItem('accentColor', newBg);
		}
		document.getElementById('color-panel')?.classList.add('hidden');
	});

	document.getElementById('color-cancel')?.addEventListener('click', () => {
		if (currentTarget === 'bot') applyColor('bot', openingColors.bot, openingColors.botText);
		else if (currentTarget === 'user') applyColor('user', openingColors.user, openingColors.userText);
		else applyColor('accent', openingColors.accent, openingColors.accent);
		document.getElementById('color-panel')?.classList.add('hidden');
	});

	document.getElementById('color-reset')?.addEventListener('click', () => {
		if (currentTarget === 'bot') {
			colorPicker.value = DEFAULT_COLORS.bot;
			applyColor('bot', DEFAULT_COLORS.bot, DEFAULT_COLORS.botText);
			localStorage.setItem('botBubbleColor', DEFAULT_COLORS.bot);
			localStorage.setItem('botTextColor', DEFAULT_COLORS.botText);
		} else if (currentTarget === 'user') {
			colorPicker.value = DEFAULT_COLORS.user;
			applyColor('user', DEFAULT_COLORS.user, DEFAULT_COLORS.userText);
			localStorage.setItem('userBubbleColor', DEFAULT_COLORS.user);
			localStorage.setItem('userTextColor', DEFAULT_COLORS.userText);
		} else {
			colorPicker.value = DEFAULT_COLORS.accent;
			applyColor('accent', DEFAULT_COLORS.accent, DEFAULT_COLORS.accent);
			localStorage.setItem('accentColor', DEFAULT_COLORS.accent);
		}
	});

	document.addEventListener('color-panel-opened', onPanelOpen);
	initColorsFromStorage();
}