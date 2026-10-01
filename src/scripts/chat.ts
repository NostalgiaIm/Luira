// ============================================================
// 聊天核心模块
// 负责：Markdown/KaTeX 渲染、流式接收、会话管理、历史持久化
// ============================================================

import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import type { Conversation } from './types';
import * as History from './history';

// ========== Markdown 渲染器配置 ==========
// KaTeX 扩展：识别 $...$ 和 $$...$$，渲染失败时保留原文（errorColor: 'inherit'）
marked.use(markedKatex({
	throwOnError: false,
	nonStandard: true,
	errorColor: 'inherit'
}));

// 代码高亮扩展：给代码块加 hljs 语法高亮
marked.use(markedHighlight({
	langPrefix: 'hljs language-',
	highlight(code: string, lang: string) {
		const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
		try {
			return hljs.highlight(code, { language }).value;
		} catch {
			return code;
		}
	}
}));

// ========== 模块级状态 ==========
// 当前会话（包含所有消息、Dify conversation_id、标题等）
let currentConversation: Conversation | null = null;
// 当前请求的中止控制器（用于「停止生成」按钮）
let currentAbortController: AbortController | null = null;

// ========== 公式分隔符归一化 ==========
/**
 * 把模型输出的各种 LaTeX 分隔符变体，统一转换成 KaTeX 能识别的 $ / $$ 形式。
 *
 * 为什么需要这个：
 * - KaTeX 只认 $ 和 $$ 两种分隔符
 * - 但模型（尤其是 7B 小模型）会输出各种变体：
 *     \( \)  \[ \]      LaTeX 标准语法（KaTeX 不识别！）
 *     $$$               模型手抖多打了一个
 *     \\( \\[           反斜杠被转义两次
 * - 所以这里统一归一化，减少后端的解析负担
 *
 * 同时保护代码块和行内代码，避免代码里的 $、\( 被误判为公式
 */
function normalizeFormulas(text: string): string {
	let processedText = text;

	// ---------- 第一步：保护代码块 ----------
	// 把 ```...``` 和 `...` 替换成占位符，避免后续正则误伤
	const codeBlocks: string[] = [];
	const inlineCodes: string[] = [];

	processedText = processedText.replace(/```[\s\S]*?```/g, (match) => {
		const key = `%%CODEBLOCK_${codeBlocks.length}%%`;
		codeBlocks.push(match);
		return key;
	});
	processedText = processedText.replace(/`[^`\n]+`/g, (match) => {
		const key = `%%INLINECODE_${inlineCodes.length}%%`;
		inlineCodes.push(match);
		return key;
	});

	// ---------- 第二步：归一化分隔符（核心修复） ----------
	// 目标：所有变体最终都变成 $ 或 $$

	// 2.1 三个或更多的 $ → 两个 $（$$$ → $$）
	processedText = processedText.replace(/\${3,}/g, '$$');

	// 2.2 双反斜杠变体：\\( → $，\\[ → $$
	processedText = processedText.replace(/\\{2,}\(/g, '$');
	processedText = processedText.replace(/\\{2,}\)/g, '$');
	processedText = processedText.replace(/\\{2,}\[/g, '$$');
	processedText = processedText.replace(/\\{2,}\]/g, '$$');

	// 2.3 单反斜杠变体：\( → $，\[ → $$（这是关键修复！）
	//     之前的版本只做了 \\( → \(，漏掉了 \( → $
	//     导致 KaTeX 根本不识别这些公式
	processedText = processedText.replace(/\\\(/g, '$');
	processedText = processedText.replace(/\\\)/g, '$');
	processedText = processedText.replace(/\\\[/g, '$$');
	processedText = processedText.replace(/\\\]/g, '$$');

	// ---------- 第三步：清理块级公式内部换行 ----------
	// KaTeX 对 $$ ... $$ 内部的换行很敏感，会直接报错
	// 所以把内部换行压成空格
	processedText = processedText.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, inner) => {
		return '$$' + inner.replace(/\n/g, ' ').trim() + '$$';
	});

	// ---------- 第四步：清理行内公式前后多余空格 ----------
	// $ x^2 $ → $x^2$，避免 KaTeX 把空格当公式内容
	processedText = processedText.replace(/\$\s+([^\$\n]+?)\s+\$/g, (_match, inner) => {
		return '$' + inner.trim() + '$';
	});

	// ---------- 第五步：还原代码块 ----------
	processedText = processedText.replace(/%%INLINECODE_(\d+)%%/g, (_match, index) => {
		return inlineCodes[Number(index)] || '';
	});
	processedText = processedText.replace(/%%CODEBLOCK_(\d+)%%/g, (_match, index) => {
		return codeBlocks[Number(index)] || '';
	});

	return processedText;
}

// ========== 渲染单条消息 ==========
/**
 * 把模型输出的原始文本渲染成 HTML。
 *
 * 流程：原始文本 → normalizeFormulas 归一化 → marked 解析 → HTML
 *
 * marked 会同时处理 Markdown 语法和 KaTeX 公式（通过 marked-katex-extension）。
 * 如果某段公式语法有误，KaTeX 会保留原文而不是崩溃（errorColor: 'inherit'）。
 */
function renderMessage(text: string): string {
	const processedText = normalizeFormulas(text);
	try {
		return marked.parse(processedText) as string;
	} catch (err) {
		console.warn('Markdown 渲染失败，降级为原文：', err);
		return processedText;
	}
}

// ========== 代码块增强 ==========
/**
 * 给每个代码块加上「语言标签 + 复制按钮」的头部。
 *
 * 处理过的代码块会用 .code-block-wrapper 包裹，
 * 重复调用时会跳过已处理的，避免重复包裹。
 */
function enhanceCodeBlocks(container: HTMLElement) {
	container.querySelectorAll('pre').forEach(pre => {
		// 已经处理过的跳过
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
				setTimeout(() => {
					copyBtn.textContent = '📋 复制';
					copyBtn.classList.remove('copied');
				}, 1500);
			} catch {
				// 静默失败
			}
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

// ========== DOM 元素引用 ==========
/**
 * 集中获取聊天相关的 DOM 元素，避免到处写 getElementById。
 * 注意：这些元素必须在 initChat 之前已经存在于 DOM 中。
 */
function getEls() {
	return {
		chatHistory: document.getElementById('chat-history') as HTMLDivElement,
		chatInput: document.getElementById('chat-input') as HTMLInputElement,
		sendBtn: document.getElementById('send-btn') as HTMLButtonElement,
		stopBtn: document.getElementById('stop-btn') as HTMLButtonElement,
	};
}

// ========== 添加消息到 DOM ==========
/**
 * 创建一条聊天消息并追加到聊天记录区。
 *
 * @param sender   'user' 或 'bot'
 * @param text     消息文本。bot 消息会经过 Markdown + KaTeX 渲染
 * @param renderMd 是否对 bot 消息做 Markdown 渲染（默认 true）
 * @returns 消息的气泡元素（bubble），方便后续流式更新内容
 */
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
		// 用户消息和空 bot 消息使用纯文本，避免 XSS
		bubbleDiv.textContent = text;
	}

	msgContentDiv.appendChild(bubbleDiv);
	msgDiv.appendChild(avatarDiv);
	msgDiv.appendChild(msgContentDiv);
	chatHistory.appendChild(msgDiv);
	chatHistory.scrollTop = chatHistory.scrollHeight;

	return bubbleDiv;
}

// ========== 消息操作栏 ==========
/**
 * 在消息气泡下方追加「复制 + 重新生成」操作栏。
 *
 * @param bubbleEl 消息的气泡元素
 * @param sender   'user' 或 'bot'，决定重新生成的行为
 */
function appendActionButtons(bubbleEl: HTMLDivElement, sender: string) {
	const msgContent = bubbleEl.parentElement;
	if (!msgContent) return;

	// 移除已有的操作栏（避免重复）
	const oldActions = msgContent.querySelector('.msg-actions');
	if (oldActions) oldActions.remove();

	const actionsDiv = document.createElement('div');
	actionsDiv.className = 'msg-actions';

	// 复制按钮
	const copyBtn = document.createElement('button');
	copyBtn.className = 'action-btn';
	copyBtn.innerHTML = '📋 复制';
	copyBtn.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(bubbleEl.innerText);
			copyBtn.innerHTML = '✅ 已复制';
			setTimeout(() => {
				copyBtn.innerHTML = '📋 复制';
			}, 1500);
		} catch {
			// 静默失败
		}
	});

	// 重新生成按钮
	const regenBtn = document.createElement('button');
	regenBtn.className = 'action-btn';
	regenBtn.innerHTML = '🔄 重新生成';
	regenBtn.addEventListener('click', () => regenerateFromBubble(bubbleEl, sender));

	actionsDiv.appendChild(copyBtn);
	actionsDiv.appendChild(regenBtn);
	msgContent.appendChild(actionsDiv);
}

// ========== 重新生成 ==========
/**
 * 从指定消息重新生成。
 *
 * 逻辑：
 *   1. 找到该消息在 DOM 中的位置
 *   2. 找到它对应的用户消息（bot 消息的前一条，或 user 消息自身）
 *   3. 删除该用户消息及其之后的所有消息
 *   4. 重新发送用户消息
 *
 * 这样既保证 DOM 和 messages 数据一致，也保证会话历史正确。
 */
async function regenerateFromBubble(bubbleEl: HTMLDivElement, sender: string) {
	const msgDiv = bubbleEl.closest('.chat-message') as HTMLElement;
	if (!msgDiv || !currentConversation) return;

	const allMessages = Array.from(getEls().chatHistory.children);
	const idx = allMessages.indexOf(msgDiv);
	if (idx === -1) return;

	// 找到对应的用户消息文本
	let userText = '';
	const userIdx = sender === 'user' ? idx : idx - 1;
	const userMsgEl = allMessages[userIdx] as HTMLElement;
	if (userMsgEl) {
		const userBubble = userMsgEl.querySelector('.bubble');
		userText = userBubble?.textContent || '';
	}
	if (!userText) return;

	// 删除用户消息及其之后的所有 DOM 消息
	const keepCount = userIdx;
	const removeList: Element[] = [];
	allMessages.forEach((el, i) => {
		if (i >= keepCount) removeList.push(el);
	});
	removeList.forEach(el => el.remove());

	// 同步修剪消息数据，保证和 DOM 一致
	currentConversation.messages = currentConversation.messages.slice(0, keepCount);

	// 重新请求
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

// ========== 核心：请求 AI 并流式渲染 ==========
/**
 * 向 /api/chat 发起请求，读取 SSE 流，逐段更新气泡内容。
 *
 * 主要流程：
 *   1. 创建 AbortController（用于「停止生成」）
 *   2. 用 fetch 发起 POST 请求，body 里带 conversation_id 以维持上下文
 *   3. 读取流数据，用 buffer 拼接不完整的行（跨 chunk 问题）
 *   4. 每收到一个完整的 SSE data 事件，就更新一次气泡
 *   5. 全部结束后做最终渲染
 */
async function fetchAIResponse(message: string, botBubbleEl: HTMLDivElement) {
	if (!currentConversation) return;

	let fullReply = '';                       // 累计的完整回复文本
	const thinkingStartTime = Date.now();     // 「动脑中」动画开始时间
	const MIN_THINKING_MS = 500;              // 动画最少显示时长（毫秒）
	let firstChunkRendered = false;           // 是否已经渲染过第一个 chunk
	let wasAborted = false;                   // 是否被用户主动中止

	// 创建中止控制器
	currentAbortController = new AbortController();
	const signal = currentAbortController.signal;

	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message,
				conversation_id: currentConversation.difyConversationId
			}),
			signal
		});

		if (!response.ok) throw new Error('网络响应错误');

		const reader = response.body?.getReader();
		const decoder = new TextDecoder('utf-8');
		if (!reader) throw new Error('无法读取流式响应');

		const { chatHistory } = getEls();
		let sseBuffer = '';   // SSE 行缓冲（处理跨 chunk 的半行问题）

		// ---------- 处理单个 SSE data 行 ----------
		async function handleSseLine(rawLine: string) {
			const line = rawLine.trimEnd();
			if (!line.startsWith('data: ')) return;

			const dataStr = line.slice(6);
			if (dataStr === '[DONE]') return;

			try {
				const data = JSON.parse(dataStr);

				// 更新 Dify conversation_id
				if (data.conversation_id && currentConversation) {
					currentConversation.difyConversationId = data.conversation_id;
				}

				// 跳过 agent_thought 事件（内部思考）
				if (data.event === 'agent_thought') return;

				// 处理正式的 answer 内容
				if (data.answer) {
					fullReply += data.answer;

					// 过滤 <think> 标签和常见的"思考独白"开头
					let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
					const isThinkingText = /^(好的，我现在|用户是一位|用户需要|首先，我需要|我需要确认|用户希望|标签包裹)/.test(cleanReply);

					if (cleanReply !== '' && !isThinkingText) {
						// 确保「动脑中」动画至少显示 MIN_THINKING_MS
						if (!firstChunkRendered) {
							firstChunkRendered = true;
							const elapsed = Date.now() - thinkingStartTime;
							const wait = Math.max(0, MIN_THINKING_MS - elapsed);
							if (wait > 0) await new Promise(r => setTimeout(r, wait));
							botBubbleEl.innerHTML = '';
						}

						// 用 requestAnimationFrame 节流渲染，避免高频重排导致闪烁
						if (!(window as any).renderPending) {
							(window as any).renderPending = true;
							(window as any).latestReply = cleanReply;
							requestAnimationFrame(() => {
								botBubbleEl.innerHTML = renderMessage((window as any).latestReply);
								enhanceCodeBlocks(botBubbleEl);
								(window as any).renderPending = false;

								// 只有用户原本就在底部附近才自动滚动
								const isScrolledToBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 100;
								if (isScrolledToBottom) chatHistory.scrollTop = chatHistory.scrollHeight;
							});
						} else {
							// 已经有 pending 的渲染时，只更新最新内容
							(window as any).latestReply = cleanReply;
						}
					}
				}
			} catch {
				// JSON 解析失败，忽略这一行
			}
		}

		// ---------- 读取流数据 ----------
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			// 关键：把新数据追加到 buffer，按 \n 切分，最后一段留到下一次
			sseBuffer += decoder.decode(value, { stream: true });
			const lines = sseBuffer.split('\n');
			sseBuffer = lines.pop() || '';   // 最后一段可能不完整，留到下一轮

			for (const line of lines) {
				await handleSseLine(line);
			}
		}

		// 处理 buffer 里残留的最后一行
		const tail = decoder.decode();
		if (tail) sseBuffer += tail;
		if (sseBuffer.trim()) await handleSseLine(sseBuffer);

		// ---------- 流结束后的最终渲染 ----------
		if (fullReply) {
			let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
			const isThinkingText = /^(好的，我现在|用户是一位|用户需要|首先，我需要|我需要确认|用户希望|标签包裹)/.test(cleanReply);

			if (isThinkingText) {
				botBubbleEl.innerHTML = '⚠️ 模型输出异常，请尝试点击下方"重新生成"。';
			} else {
				botBubbleEl.innerHTML = renderMessage(cleanReply);
				enhanceCodeBlocks(botBubbleEl);
				// 把 bot 回复写入会话历史
				if (currentConversation) {
					currentConversation.messages.push({ role: 'bot', content: cleanReply });
				}
			}
		} else if (!wasAborted) {
			botBubbleEl.innerHTML = '⚠️ 模型没有返回内容。';
		}
	} catch (error: any) {
		if (error.name === 'AbortError') {
			// 用户主动点击「停止」
			wasAborted = true;
			if (fullReply) {
				let cleanReply = fullReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
				botBubbleEl.innerHTML = renderMessage(cleanReply) + '<div class="abort-hint">⏹ 已停止生成</div>';
				enhanceCodeBlocks(botBubbleEl);
				if (currentConversation) {
					currentConversation.messages.push({ role: 'bot', content: cleanReply });
				}
			} else {
				botBubbleEl.innerHTML = '<div class="abort-hint">⏹ 已停止生成</div>';
			}
		} else {
			console.error('发送失败:', error);
			botBubbleEl.innerHTML = '❌ 发送失败，请查看控制台。';
		}
	} finally {
		currentAbortController = null;
	}
}

// ========== 发送消息 ==========
/**
 * 用户发送消息的入口函数。
 * 步骤：
 *   1. 读取输入框内容
 *   2. 把用户消息追加到 DOM 和会话数据
 *   3. 创建 bot 占位气泡（显示「动脑中」动画）
 *   4. 调用 fetchAIResponse 发起请求
 *   5. 请求结束后追加操作栏（复制 / 重新生成）
 */
async function sendMessage() {
	const { chatInput, sendBtn, stopBtn } = getEls();
	const message = chatInput.value.trim();
	if (!message || !currentConversation) return;

	chatInput.value = '';

	// 用户消息
	addMessageToDom('user', message);
	currentConversation.messages.push({ role: 'user', content: message });

	// 如果是第一条消息，用它生成会话标题
	if (currentConversation.messages.length === 1) {
		currentConversation.title = History.generateTitle(message);
	}

	// bot 占位气泡
	const botBubbleEl = addMessageToDom('bot', '');
	botBubbleEl.innerHTML = `<div class="thinking-indicator"><span>动脑中</span><span class="dots"><span>.</span><span>.</span><span>.</span></span></div>`;

	// 切换按钮状态
	sendBtn.classList.add('hidden');
	stopBtn.classList.remove('hidden');

	await fetchAIResponse(message, botBubbleEl);
	appendActionButtons(botBubbleEl, 'bot');
	persistCurrent();

	// 恢复按钮状态
	sendBtn.classList.remove('hidden');
	stopBtn.classList.add('hidden');
}

// ========== 会话持久化 ==========
/**
 * 把当前会话写回 localStorage。
 * 每次 AI 回复完成后调用，保证历史不丢。
 */
function persistCurrent() {
	if (!currentConversation) return;
	currentConversation.updatedAt = Date.now();
	History.upsertConversation(currentConversation);
	renderHistoryList();
}

// ========== 从会话渲染整个聊天区 ==========
/**
 * 从 Conversation 数据渲染整个聊天区域。
 * 用于切换历史会话时重建 DOM。
 */
function renderChatFromConversation(conv: Conversation) {
	const { chatHistory } = getEls();
	chatHistory.innerHTML = '';
	conv.messages.forEach(m => {
		const bubble = addMessageToDom(m.role, m.content);
		appendActionButtons(bubble, m.role);
	});
}

// ========== 加载会话 ==========
/**
 * 切换到指定的历史会话。
 */
function loadConversation(id: string) {
	const conv = History.getConversation(id);
	if (!conv) return;
	currentConversation = conv;
	History.setCurrentConversationId(id);
	renderChatFromConversation(conv);
	renderHistoryList();
}

// ========== 新建会话 ==========
/**
 * 创建一个全新的空会话。
 */
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

// ========== 渲染历史列表 ==========
/**
 * 渲染侧边栏的「最近会话」列表。
 * 每次会话增删改后调用。
 */
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
			e.stopPropagation();  // 阻止触发 loadConversation
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

// ========== 初始化聊天模块 ==========
/**
 * 由 main.ts 调用，初始化聊天区域。
 *
 * 步骤：
 *   1. 尝试从 localStorage 恢复上次的会话
 *   2. 如果没有，创建一个新会话
 *   3. 绑定各种按钮事件
 */
export function initChat() {
	const { chatInput, sendBtn, stopBtn } = getEls();

	// 恢复上次会话或新建
	const lastId = History.getCurrentConversationId();
	if (lastId && History.getConversation(lastId)) {
		loadConversation(lastId);
	} else {
		newConversation();
	}

	// 绑定事件
	sendBtn.addEventListener('click', sendMessage);
	chatInput.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') sendMessage();
	});
	stopBtn.addEventListener('click', () => {
		if (currentAbortController) currentAbortController.abort();
	});
	document.getElementById('new-chat-btn')?.addEventListener('click', newConversation);
}