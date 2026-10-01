import type { BgConfig } from './types';

const DEFAULT_BG: BgConfig = { url: '', opacity: 0.95, blur: 0, sidebar: true, chat: true, transparent: false };

export function initBackground() {
	const bgUrlInput = document.getElementById('bg-url-input') as HTMLInputElement;
	const bgOpacity = document.getElementById('bg-opacity') as HTMLInputElement;
	const bgOpacityValue = document.getElementById('bg-opacity-value') as HTMLSpanElement;
	const bgBlur = document.getElementById('bg-blur') as HTMLInputElement;
	const bgBlurValue = document.getElementById('bg-blur-value') as HTMLSpanElement;
	const bgSidebarToggle = document.getElementById('bg-sidebar-toggle') as HTMLInputElement;
	const bgChatToggle = document.getElementById('bg-chat-toggle') as HTMLInputElement;
	const bgTransparentToggle = document.getElementById('bg-transparent-toggle') as HTMLInputElement;
	const bgFileInput = document.getElementById('bg-file-input') as HTMLInputElement;
	const bgPreviewLayer = document.getElementById('bg-preview-layer') as HTMLDivElement;

	function createBgLayer(): HTMLDivElement {
		const layer = document.createElement('div');
		layer.id = 'bg-layer';
		document.body.insertBefore(layer, document.body.firstChild);
		return layer;
	}

	function applyBackground(config: BgConfig) {
		const bgLayer = document.getElementById('bg-layer') || createBgLayer();
		const body = document.body;
		if (config.url) {
			bgLayer.style.backgroundImage = `url('${config.url}')`;
			bgLayer.style.opacity = String(config.opacity);
			bgLayer.style.filter = `blur(${config.blur}px)`;
			bgLayer.style.display = 'block';
			body.classList.add('has-bg');
		} else {
			bgLayer.style.backgroundImage = 'none';
			bgLayer.style.display = 'none';
			body.classList.remove('has-bg');
		}
		body.classList.toggle('bg-sidebar-enabled', config.sidebar);
		body.classList.toggle('bg-chat-enabled', config.chat);
		body.classList.toggle('bg-transparent-mode', config.transparent);
	}

	function updatePreview(url: string, opacity: number, blur: number) {
		if (!bgPreviewLayer) return;
		if (url) {
			bgPreviewLayer.style.backgroundImage = `url('${url}')`;
			bgPreviewLayer.style.opacity = String(opacity);
			bgPreviewLayer.style.filter = `blur(${blur}px)`;
		} else {
			bgPreviewLayer.style.backgroundImage = 'none';
		}
	}

	function getBgConfig(): BgConfig {
		const savedOpacity = localStorage.getItem('bgOpacity');
		const savedBlur = localStorage.getItem('bgBlur');
		const opacity = savedOpacity === null ? NaN : parseFloat(savedOpacity);
		const blur = savedBlur === null ? NaN : parseInt(savedBlur);

		return {
			url: localStorage.getItem('bgUrl') || DEFAULT_BG.url,
			opacity: Number.isNaN(opacity) ? DEFAULT_BG.opacity : opacity,
			blur: Number.isNaN(blur) ? DEFAULT_BG.blur : blur,
			sidebar: localStorage.getItem('bgSidebar') !== 'false',
			chat: localStorage.getItem('bgChat') !== 'false',
			transparent: localStorage.getItem('bgTransparent') === 'true'
		};
	}

	function syncBgPanelFromStorage() {
		const config = getBgConfig();
		bgUrlInput.value = config.url;
		bgOpacity.value = String(config.opacity);
		bgOpacityValue.textContent = String(config.opacity);
		bgBlur.value = String(config.blur);
		bgBlurValue.textContent = config.blur + 'px';
		bgSidebarToggle.checked = config.sidebar;
		bgChatToggle.checked = config.chat;
		bgTransparentToggle.checked = config.transparent;
		updatePreview(config.url, config.opacity, config.blur);
	}

	function getCurrentConfig(): BgConfig {
		return {
			url: bgUrlInput.value.trim(),
			opacity: parseFloat(bgOpacity.value),
			blur: parseInt(bgBlur.value),
			sidebar: bgSidebarToggle.checked,
			chat: bgChatToggle.checked,
			transparent: bgTransparentToggle.checked
		};
	}

	document.getElementById('bg-browse-btn')?.addEventListener('click', () => bgFileInput.click());
	bgFileInput?.addEventListener('change', (e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			alert('图片太大了（超过 5MB），请选择小一点的图片。');
			return;
		}
		const reader = new FileReader();
		reader.onload = (ev) => {
			const dataUrl = ev.target?.result as string;
			bgUrlInput.value = dataUrl;
			applyBackground(getCurrentConfig());
			updatePreview(dataUrl, parseFloat(bgOpacity.value), parseInt(bgBlur.value));
		};
		reader.readAsDataURL(file);
	});

	bgOpacity.addEventListener('input', () => {
		bgOpacityValue.textContent = bgOpacity.value;
		const cfg = getCurrentConfig();
		applyBackground(cfg);
		updatePreview(cfg.url, cfg.opacity, cfg.blur);
	});
	bgBlur.addEventListener('input', () => {
		bgBlurValue.textContent = bgBlur.value + 'px';
		const cfg = getCurrentConfig();
		applyBackground(cfg);
		updatePreview(cfg.url, cfg.opacity, cfg.blur);
	});
	bgUrlInput.addEventListener('change', () => {
		const cfg = getCurrentConfig();
		applyBackground(cfg);
		updatePreview(cfg.url, cfg.opacity, cfg.blur);
	});
	bgSidebarToggle.addEventListener('change', () => applyBackground(getCurrentConfig()));
	bgChatToggle.addEventListener('change', () => applyBackground(getCurrentConfig()));
	bgTransparentToggle.addEventListener('change', () => applyBackground(getCurrentConfig()));

	document.getElementById('bg-save')?.addEventListener('click', () => {
		try {
			const cfg = getCurrentConfig();
			localStorage.setItem('bgUrl', cfg.url);
			localStorage.setItem('bgOpacity', String(cfg.opacity));
			localStorage.setItem('bgBlur', String(cfg.blur));
			localStorage.setItem('bgSidebar', String(cfg.sidebar));
			localStorage.setItem('bgChat', String(cfg.chat));
			localStorage.setItem('bgTransparent', String(cfg.transparent));
			document.getElementById('bg-panel')?.classList.add('hidden');
		} catch (err) {
			alert('保存失败，图片可能太大了。');
		}
	});

	document.getElementById('bg-reset')?.addEventListener('click', () => {
		['bgUrl', 'bgOpacity', 'bgBlur', 'bgSidebar', 'bgChat', 'bgTransparent'].forEach(k => localStorage.removeItem(k));
		applyBackground(DEFAULT_BG);
		syncBgPanelFromStorage();
		updatePreview('', 0.95, 0);
	});

	document.addEventListener('bg-panel-opened', syncBgPanelFromStorage);
	applyBackground(getBgConfig());
}