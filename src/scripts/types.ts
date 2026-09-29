export interface ChatMessage {
	role: 'user' | 'bot';
	content: string;
}

export interface Conversation {
	id: string;
	difyConversationId: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
}

export interface BgConfig {
	url: string;
	opacity: number;
	blur: number;
	sidebar: boolean;
	chat: boolean;
	transparent: boolean;
}