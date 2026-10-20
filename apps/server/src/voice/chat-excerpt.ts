import type { ChatItem } from '@ruimte/contracts';

export interface ChatExcerptMessage {
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
}

export interface ChatExcerpt {
    messages: ChatExcerptMessage[];
    truncated: boolean;
}

// What a spoken summary can take in, and what one long answer may take of it.
const MAX_TOTAL_CHARACTERS = 12_000;
const MAX_MESSAGE_CHARACTERS = 3_000;

type MessageItem = Extract<ChatItem, { kind: 'user' | 'assistant' }>;

/* The words people and the agent said to each other: no reasoning, no tool output, and nothing a sub-agent said inside a tool. */
function spoken(item: ChatItem): item is MessageItem {
    if (item.kind !== 'user' && item.kind !== 'assistant') {
        return false;
    }
    if (item.kind === 'assistant' && item.parentToolUseId) {
        return false;
    }
    return item.text.trim() !== '';
}

function clip(text: string, limit: number): string {
    return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

/*
 * The last messages of a chat for Voice to read out, newest kept first when the whole does not fit.
 * The client reads the same excerpt with `recentChatMessages` of `@adecore/agents-react`, which the
 * daemon cannot import without React; both follow the rules of the `chat.read` action.
 */
export function chatExcerpt(items: readonly ChatItem[], limit: number): ChatExcerpt {
    const eligible = items.filter(spoken);
    const candidates = eligible.slice(-limit);
    const messages: ChatExcerptMessage[] = [];
    let characters = 0;
    let truncated = candidates.length < eligible.length;
    for (const item of candidates.toReversed()) {
        const remaining = MAX_TOTAL_CHARACTERS - characters;
        if (remaining <= 0) {
            truncated = true;
            break;
        }
        const whole = item.text.trim();
        const text = clip(clip(whole, MAX_MESSAGE_CHARACTERS), remaining);
        messages.unshift({ role: item.kind, text, createdAt: item.createdAt });
        characters += text.length;
        truncated ||= text.length < whole.length;
    }
    return { messages, truncated };
}
