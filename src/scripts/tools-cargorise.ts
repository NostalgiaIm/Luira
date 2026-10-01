import type { CargoRiseDetectResponse } from './types';

function formatResult(data: unknown) {
	return JSON.stringify(data, null, 2);
}

export function initCargoRiseTools() {
	const detectBtn = document.getElementById('cargorise-detect-btn') as HTMLButtonElement | null;
	const statusEl = document.getElementById('cargorise-detect-status');
	const outputEl = document.getElementById('cargorise-detect-output');

	detectBtn?.addEventListener('click', async () => {
		if (!statusEl || !outputEl) return;

		detectBtn.disabled = true;
		statusEl.textContent = '检测中...';
		outputEl.classList.add('hidden');

		try {
			const response = await fetch('/api/tools/cargorise', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'detect' })
			});
			const data = await response.json().catch(() => null) as CargoRiseDetectResponse | null;

			if (!response.ok || !data?.ok) {
				statusEl.textContent = data?.message || '检测失败';
			} else {
				statusEl.textContent = '检测完成';
			}

			outputEl.textContent = formatResult(data);
			outputEl.classList.remove('hidden');
		} catch {
			statusEl.textContent = '检测请求失败';
		} finally {
			detectBtn.disabled = false;
		}
	});
}
