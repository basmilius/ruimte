import type { ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@ruimte/agents-react/state/chats';

export interface VoiceChatFollowUp {
    key: string;
    project?: string;
    chat: string;
    turnId: string;
}

export interface VoiceChatCompletion {
    state: 'done' | 'aborted' | 'error';
    answer: string;
}

const MAX_ANSWER_CHARS = 12_000;

const answerOf = (chat: ChatState, turnId: string): string =>
    chat.order
        .map((id) => chat.items[id])
        .filter((item): item is Extract<ChatItem, { kind: 'assistant' }> => item?.kind === 'assistant' && item.turnId === turnId && !item.parentToolUseId)
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, MAX_ANSWER_CHARS);

/*
 * The turn's own item says how it ended. A long turn's item sits before the page this client holds,
 * so then the chat no longer running it is the end, and an error note in it the only state it shows.
 */
const settledState = (chat: ChatState, turnId: string): VoiceChatCompletion['state'] | null => {
    const turn = chat.items[turnId];
    if (turn?.kind === 'turn') {
        return turn.state === 'running' ? null : turn.state;
    }
    const own = chat.order.map((id) => chat.items[id]).filter((item) => item?.turnId === turnId);
    if (own.length === 0 || chat.info.activeTurnId === turnId) {
        return null;
    }
    return own.some((item) => item?.kind === 'note' && item.level === 'error') ? 'error' : 'done';
};

export const chatCompletion = (chat: ChatState | undefined, turnId: string): VoiceChatCompletion | null => {
    if (!chat) {
        return null;
    }
    const state = settledState(chat, turnId);
    return state === null ? null : { state, answer: answerOf(chat, turnId) };
};

export const completionPrompt = (followUp: VoiceChatFollowUp, completion: VoiceChatCompletion): string => {
    const result = completion.answer || 'The AI Chat returned no final answer.';
    return `Ruimte completion event. The user asked you to report when AI Chat “${followUp.chat}” finished. Project: ${followUp.project ?? 'the original project'}. Its tracked turn ${followUp.turnId} ended with state ${completion.state}. Final answer:\n${result}\nEnd of quoted AI Chat result.`;
};
