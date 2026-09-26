import type { ChatItem } from '@ruimte/agent-contracts';

export interface RecentChatMessage {
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
}

export interface RecentChatMessages {
    messages: RecentChatMessage[];
    truncated: boolean;
}

const MAX_TOTAL_CHARACTERS = 12_000;
const MAX_MESSAGE_CHARACTERS = 3_000;

const clipped = (text: string): { text: string; truncated: boolean } =>
    text.length <= MAX_MESSAGE_CHARACTERS ? { text, truncated: false } : { text: `${text.slice(0, MAX_MESSAGE_CHARACTERS - 1)}…`, truncated: true };

type MessageItem = Extract<ChatItem, { kind: 'user' | 'assistant' }>;

const isMessage = (item: ChatItem | undefined): item is MessageItem =>
    item !== undefined && (item.kind === 'user' || item.kind === 'assistant') && item.text.trim() !== '';

/* The last messages of a conversation already cut down to the ones worth reading, clipped to what a reader can take in. */
export const recentMessages = (eligible: readonly MessageItem[], limit: number): RecentChatMessages => {
    const candidates = eligible.slice(-limit);
    const messages: RecentChatMessage[] = [];
    let characters = 0;
    let truncated = candidates.length < eligible.length;
    for (const item of candidates.toReversed()) {
        const message = clipped(item.text.trim());
        const remaining = MAX_TOTAL_CHARACTERS - characters;
        if (remaining <= 0) {
            truncated = true;
            break;
        }
        const text = message.text.length <= remaining ? message.text : `${message.text.slice(0, Math.max(0, remaining - 1))}…`;
        messages.unshift({ role: item.kind, text, createdAt: item.createdAt });
        characters += text.length;
        truncated ||= message.truncated || text.length < message.text.length;
    }
    return { messages, truncated };
};

/* A sub-agent's replies sit in the thread too, and belong to its own conversation rather than the chat's. */
export const recentChatMessages = (items: Record<string, ChatItem>, order: readonly string[], limit: number): RecentChatMessages =>
    recentMessages(
        order.map((id) => items[id]).filter((item): item is MessageItem => isMessage(item) && !(item.kind === 'assistant' && item.parentToolUseId)),
        limit
    );

/* Everything in a sub-agent's conversation is its own, so nothing is left out for being nested. */
export const recentSubagentMessages = (items: readonly ChatItem[], limit: number): RecentChatMessages => recentMessages(items.filter(isMessage), limit);
