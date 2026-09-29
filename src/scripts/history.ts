import type { Conversation } from './types';

const STORAGE_KEY = 'dify_conversations';
const CURRENT_KEY = 'dify_current_conv_id';

export function loadConversations(): Conversation[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

export function saveConversations(list: Conversation[]): void {
	try {
		const trimmed = list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
	} catch (e) {
		console.error('保存历史失败:', e);
	}
}

export function createConversation(): Conversation {
	return {
		id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		difyConversationId: '',
		title: '新对话',
		messages: [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

export function upsertConversation(conv: Conversation): void {
	const list = loadConversations();
	const idx = list.findIndex(c => c.id === conv.id);
	if (idx >= 0) list[idx] = conv;
	else list.unshift(conv);
	saveConversations(list);
}

export function deleteConversation(id: string): void {
	const list = loadConversations().filter(c => c.id !== id);
	saveConversations(list);
	if (getCurrentConversationId() === id) {
		localStorage.removeItem(CURRENT_KEY);
	}
}

export function getConversation(id: string): Conversation | null {
	return loadConversations().find(c => c.id === id) || null;
}

export function getCurrentConversationId(): string | null {
	return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentConversationId(id: string): void {
	localStorage.setItem(CURRENT_KEY, id);
}

export function generateTitle(text: string): string {
	return text.trim().slice(0, 20) || '新对话';
}