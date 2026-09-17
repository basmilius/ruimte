import type { ChatItem } from '@ruimte/contracts';

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

export const recentChatMessages = (items: Record<string, ChatItem>, order: readonly string[], limit: number): RecentChatMessages => {
    const eligible = order
        .map((id) => items[id])
        .filter(
            (item): item is Extract<ChatItem, { kind: 'user' | 'assistant' }> =>
                item !== undefined && (item.kind === 'user' || (item.kind === 'assistant' && !item.parentToolUseId)) && item.text.trim() !== ''
        );
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
