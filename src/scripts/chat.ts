import katex from 'katex';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import type { Conversation } from './types';
import * as History from './history';

marked.use(markedKatex({ throwOnError: false, nonStandard: true, errorColor: 'inherit' }));
marked.use(markedHighlight({
	langPrefix: 'hljs language-',
	highlight(code: string, lang: string) {
		const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
		try { return hljs.highlight(code, { language }).value; } catch { return code; }
	}
}));

let currentConversation: Conversation | null = null;
let currentAbortController: AbortController | null = null;

function renderMessage(text: string) {
	let processedText = text;

	// 1. 兼容 \[ ... \] 和 \( ... \)
	processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
	processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$$');

	// 2. 👈 关键修复：清理 $$ ... $$ 前后的空格和换行
	processedText = processedText.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, '$$$$$1$$$$');
	// 3. 👈 关键修复：清理 $ ... $ 前后的空格
	processedText = processedText.replace(/\$\s+([^\$\n]+?)\s+\$/g, '$$$1$$$');

	// 4. 自动补全裸奔的 LaTeX（独立整行）
	processedText = processedText.replace(/^([^\$\n]+)$/gm, (match, p1) => {
		const line = p1.trim();
		if (line !== '' && !line.includes('$') && /\\[a-zA-Z]+|_pF_q|_q|_a|_b|\^/.test(line)) return `$$${line}$$`;
		return match;
	});

	try { return marked.parse(processedText) as string; } catch { return processedText; }
}

function enhanceCodeBlocks(container: HTMLElement) {
	container.querySelectorAll('pre').forEach(pre => {
		if (pre.parentElement?.classList.contains('code-block-wrapper')) return;
		const codeEl = pre.querySelector('code');
		let lang = 'code';
		const match = codeEl?.className.match(/language-(\w+)/);
		if (match) lang = match[1];
		const wrapper = document.createElement('div');
		wrapper.className = 'code-block-wrapper';
		const header = document.createElement('div');
		header.className = 'code-block-header';
		const langSpan = document.createElement('span');
		langSpan.className = 'code-lang';
		langSpan.textContent = lang;
		const copyBtn = document.createElement('button');
		copyBtn.className = 'copy-code-btn';
		copyBtn.textContent = '📋 复制';
		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(codeEl?.textContent || '');
				copyBtn.textContent = '✅ 已复制';
				copyBtn.classList.add('copied');
				setTimeout(() => { copyBtn.textContent = '📋 复制'; copyBtn.classList.remove('copied'); }, 1500);
			} catch { }
		});
		header.appendChild(langSpan);
		header.appendChild(copyBtn);
		const parent = pre.parentElement;
		if (parent) {
			parent.insertBefore(wrapper, pre);
			wrapper.appendChild(header);
			wrapper.appendChild(pre);
		}
	});
}

function isFormulaIncomplete(text: string): boolean {
	const singleDollarCount = (text.replace(/\$\$/g, '').match(/\$/g) || []).length;
	if (singleDollarCount % 2 !== 0) return true;
	if ((text.match(/\\\[/g) || []).length !== (text.match(/\\\]/g) || []).length) return true;
	if ((text.match(/\\\(/g) || []).length !== (text.match(/\\\)/g) || []).length) return true;
	return false;
}

function getEls() {
	return {
		chatHistory: document.getElementById('chat-history') as HTMLDivElement,
		chatInput: document.getElementById('chat-input') as HTMLInputElement,
		sendBtn: document.getElementById('send-btn') as HTMLButtonElement,
		stopBtn: document.getElementById('stop-btn') as HTMLButtonElement,
	};
}

function addMessageToDom(sender: string, text: string, renderMd = true): HTMLDivElement {
	const { chatHistory } = getEls();
	const msgDiv = document.createElement('div');
	msgDiv.className = `chat-message ${sender}`;
	const avatarDiv = document.createElement('div');
	avatarDiv.className = `avatar ${sender}-avatar`;
	const msgContentDiv = document.createElement('div');
	msgContentDiv.className = 'msg-content';
	const bubbleDiv = document.createElement('div');
	bubbleDiv.className = 'bubble';
	if (sender === 'bot' && renderMd && text) {
		bubbleDiv.innerHTML = renderMessage(text);
		enhanceCodeBlocks(bubbleDiv);
	} else {
		bubbleDiv.textContent = text;
	}
	msgContentDiv.appendChild(bubbleDiv);
	msgDiv.appendChild(avatarDiv);
	msgDiv.appendChild(msgContentDiv);
	chatHistory.appendChild(msgDiv);
	chatHistory.scrollTop = chatHistory.scrollHeight;
	return bubbleDiv;
}

function appendActionButtons(bubbleEl: HTMLDivElement, sender: string) {
	const msgContent = bubbleEl.parentElement;
	if (!msgContent) return;
	const oldActions = msgContent.querySelector('.msg-actions');
	if (oldActions) oldActions.remove();
	const actionsDiv = document.createElement('div');
	actionsDiv.className = 'msg-actions';

	const copyBtn = document.createElement('button');
	copyBtn.className = 'action-btn';
	copyBtn.innerHTML = '📋 复制';
	copyBtn.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(bubbleEl.innerText);
			copyBtn.innerHTML = '✅ 已复制';
			setTimeout(() => { copyBtn.innerHTML = '📋 复制'; }, 1500);
		} catch { }
	});

	const regenBtn = document.createElement('button');
	regenBtn.className = 'action-btn';
	regenBtn.innerHTML = '🔄 重新生成';
	regenBtn.addEventListener('click', () => regenerateFromBubble(bubbleEl, sender));

	actionsDiv.appendChild(copyBtn);
	actionsDiv.appendChild(regenBtn);
	msgContent.appendChild(actionsDiv);
}

async function regenerateFromBubble(bubbleEl: HTMLDivElement, sender: string) {
	const msgDiv = bubbleEl.closest('.chat-message') as HTMLElement;
	if (!msgDiv || !currentConversation) return;

	const allMessages = Array.from(getEls().chatHistory.children);
	const idx = allMessages.indexOf(msgDiv);
	if (idx === -1) return;

	let userText = '';
	const userIdx = sender === 'user' ? idx : idx - 1;
	const userMsgEl = allMessages[userIdx] as HTMLElement;
	if (userMsgEl) {
		const userBubble = userMsgEl.querySelector('.bubble');
		userText = userBubble?.textContent || '';
	}
	if (!userText) return;

	const keepCount = userIdx;
	const removeList: Element[] = [];
	allMessages.forEach((el, i) => { if (i >= keepCount) removeList.push(el); });
	removeList.forEach(el => el.remove());

	currentConversation.messages = currentConversation.messages.slice(0, keepCount);

	const { sendBtn, stopBtn } = getEls();
	const botBubbleEl = addMessageToDom('bot', '');
	botBubbleEl.innerHTML = `<div class="thinking-indicator"><span>动脑中</span><span class="dots"><span>.</span><span>.</span><span>.</span></span></div>`;
	sendBtn.classList.add('hidden');
	stopBtn.classList.remove('hidden');
	await fetchAIResponse(userText, botBubbleEl);
	appendActionButtons(botBubbleEl, 'bot');
	sendBtn.classList.remove('hidden');
	stopBtn.classList.add('hidden');
	persistCurrent();
}

async function fetchAIResponse(message: string, botBubbleEl: HTMLDivElement) {
	if (!currentConversation) return;
	let fullReply = '';
	const thinkingStartTime = Date.now();
	const MIN_THINKING_MS = 500;
	let firstChunkRendered = false;
	let wasAborted = false;

	currentAbortController = new AbortController();
	const signal = currentAbortController.signal;

	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, conversation_id: currentConversation.difyConversationId }),
			signal
		});
		if (!response.ok) throw new Error('网络响应错误');
		const reader = response.body?.getReader();
		const decoder = new TextDecoder('utf-8');
		if (!reader) throw new Error('无法读取流式响应');
		const { chatHistory } = getEls();

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split('\n');
			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const dataStr = line.slice(6);
					if (dataStr === '[DONE]') continue;
					try {
						const data = JSON.parse(dataStr);
						if (data.conversation_id && currentConversation) {
							currentConversation.difyConversationId = data.conversation_id;
						}
						if (data.event === 'agent_thought') continue;
						if (data.answer) {
							fullReply += data.answer;
							let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
							const isThinkingText = /^(好的，我现在|用户是一位|用户需要|首先，我需要|我需要确认|用户希望|标签包裹)/.test(cleanReply);
							if (cleanReply !== '' && !isThinkingText) {
								if (!firstChunkRendered) {
									firstChunkRendered = true;
									const elapsed = Date.now() - thinkingStartTime;
									const wait = Math.max(0, MIN_THINKING_MS - elapsed);
									if (wait > 0) await new Promise(r => setTimeout(r, wait));
									botBubbleEl.innerHTML = '';
								}
								if (!isFormulaIncomplete(cleanReply)) {
									if (!(window as any).renderPending) {
										(window as any).renderPending = true;
										(window as any).latestReply = cleanReply;
										requestAnimationFrame(() => {
											botBubbleEl.innerHTML = renderMessage((window as any).latestReply);
											enhanceCodeBlocks(botBubbleEl);
											(window as any).renderPending = false;
											const isScrolledToBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 100;
											if (isScrolledToBottom) chatHistory.scrollTop = chatHistory.scrollHeight;
										});
									} else {
										(window as any).latestReply = cleanReply;
									}
								}
							}
						}
					} catch { }
				}
			}
		}
		if (fullReply) {
			let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
			const isThinkingText = /^(好的，我现在|用户是一位|用户需要|首先，我需要|我需要确认|用户希望|标签包裹)/.test(cleanReply);
			if (isThinkingText) {
				botBubbleEl.innerHTML = '⚠️ 模型输出异常，请尝试点击下方"重新生成"。';
			} else {
				botBubbleEl.innerHTML = renderMessage(cleanReply);
				enhanceCodeBlocks(botBubbleEl);
				if (currentConversation) {
					currentConversation.messages.push({ role: 'bot', content: cleanReply });
				}
			}
		} else if (!wasAborted) {
			botBubbleEl.innerHTML = '⚠️ 模型没有返回内容。';
		}
	} catch (error: any) {
		if (error.name === 'AbortError') {
			wasAborted = true;
			if (fullReply) {
				let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
				botBubbleEl.innerHTML = renderMessage(cleanReply) + '<div class="abort-hint">⏹ 已停止生成</div>';
				enhanceCodeBlocks(botBubbleEl);
				if (currentConversation) currentConversation.messages.push({ role: 'bot', content: cleanReply });
			} else {
				botBubbleEl.innerHTML = '<div class="abort-hint">⏹ 已停止生成</div>';
			}
		} else {
			botBubbleEl.innerHTML = '❌ 发送失败，请查看控制台。';
		}
	} finally {
		currentAbortController = null;
	}
}

async function sendMessage() {
	const { chatInput, sendBtn, stopBtn } = getEls();
	const message = chatInput.value.trim();
	if (!message || !currentConversation) return;
	chatInput.value = '';

	addMessageToDom('user', message);
	currentConversation.messages.push({ role: 'user', content: message });

	if (currentConversation.messages.length === 1) {
		currentConversation.title = History.generateTitle(message);
	}

	const botBubbleEl = addMessageToDom('bot', '');
	botBubbleEl.innerHTML = `<div class="thinking-indicator"><span>动脑中</span><span class="dots"><span>.</span><span>.</span><span>.</span></span></div>`;

	sendBtn.classList.add('hidden');
	stopBtn.classList.remove('hidden');

	await fetchAIResponse(message, botBubbleEl);
	appendActionButtons(botBubbleEl, 'bot');
	persistCurrent();

	sendBtn.classList.remove('hidden');
	stopBtn.classList.add('hidden');
}

function persistCurrent() {
	if (!currentConversation) return;
	currentConversation.updatedAt = Date.now();
	History.upsertConversation(currentConversation);
	renderHistoryList();
}

function renderChatFromConversation(conv: Conversation) {
	const { chatHistory } = getEls();
	chatHistory.innerHTML = '';
	conv.messages.forEach(m => {
		const bubble = addMessageToDom(m.role, m.content);
		appendActionButtons(bubble, m.role);
	});
}

function loadConversation(id: string) {
	const conv = History.getConversation(id);
	if (!conv) return;
	currentConversation = conv;
	History.setCurrentConversationId(id);
	renderChatFromConversation(conv);
	renderHistoryList();
}

function newConversation() {
	currentConversation = History.createConversation();
	History.upsertConversation(currentConversation);
	History.setCurrentConversationId(currentConversation.id);
	const { chatHistory } = getEls();
	chatHistory.innerHTML = '';
	chatHistory.classList.remove('hidden');
	const toggleChatBtn = document.getElementById('toggle-chat-btn');
	if (toggleChatBtn) toggleChatBtn.textContent = '隐藏会话';
	renderHistoryList();
}

function renderHistoryList() {
	const container = document.getElementById('history-items');
	if (!container) return;
	const list = History.loadConversations();
	const currentId = currentConversation?.id;

	container.innerHTML = '';
	if (list.length === 0) {
		container.innerHTML = '<div style="padding:8px 10px;font-size:0.75rem;color:#6b7280;">暂无历史会话</div>';
		return;
	}

	list.forEach(conv => {
		const item = document.createElement('div');
		item.className = 'history-item' + (conv.id === currentId ? ' active' : '');

		const title = document.createElement('div');
		title.className = 'title';
		title.textContent = conv.title;

		const delBtn = document.createElement('button');
		delBtn.className = 'delete-btn';
		delBtn.textContent = '🗑';
		delBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!confirm(`删除会话"${conv.title}"？`)) return;
			History.deleteConversation(conv.id);
			if (currentConversation?.id === conv.id) {
				newConversation();
			} else {
				renderHistoryList();
			}
		});

		item.appendChild(title);
		item.appendChild(delBtn);
		item.addEventListener('click', () => loadConversation(conv.id));
		container.appendChild(item);
	});
}

export function initChat() {
	const { chatInput, sendBtn, stopBtn } = getEls();

	const lastId = History.getCurrentConversationId();
	if (lastId && History.getConversation(lastId)) {
		loadConversation(lastId);
	} else {
		newConversation();
	}

	sendBtn.addEventListener('click', sendMessage);
	chatInput.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') sendMessage();
	});
	stopBtn.addEventListener('click', () => {
		if (currentAbortController) currentAbortController.abort();
	});
	document.getElementById('new-chat-btn')?.addEventListener('click', newConversation);
}