import type { ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@/state/chats';

export interface VoiceChatFollowUp {
    key: string;
    chat: string;
    turnId: string;
}

export interface VoiceChatCompletion {
    state: 'done' | 'aborted' | 'error';
    answer: string;
}

const MAX_ANSWER_CHARS = 12_000;

export const chatCompletion = (chat: ChatState | undefined, turnId: string): VoiceChatCompletion | null => {
    if (!chat) {
        return null;
    }
    const turn = chat.items[turnId];
    if (turn?.kind !== 'turn' || turn.state === 'running') {
        return null;
    }
    const answer = chat.order
        .map((id) => chat.items[id])
        .filter(
            (item): item is Extract<ChatItem, { kind: 'assistant' }> =>
                item?.kind === 'assistant' && item.turnId === turnId && !item.parentToolUseId
        )
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, MAX_ANSWER_CHARS);
    return { state: turn.state, answer };
};

export const completionPrompt = (followUp: VoiceChatFollowUp, completion: VoiceChatCompletion): string => {
    const result = completion.answer || 'The AI Chat returned no final answer.';
    return `Ruimte completion event. The user asked you to report when AI Chat “${followUp.chat}” finished. Its tracked turn ${followUp.turnId} ended with state ${completion.state}. Final answer:\n${result}\nTell the user now what happened and summarize this result concisely. Clearly say if the turn was aborted or failed. Do not claim that you performed the target chat's work yourself.`;
};
