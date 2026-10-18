import type { ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@adecore/agents-react/state';
import { splitKey } from '@/state/keys';

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

/*
 * What the voice gets of an answer. It summarizes in a sentence or two, so more only costs appends
 * before it can speak; the rest stays in the chat, where chat.read reads it on request.
 */
const SPOKEN_ANSWER_CHARS = 1200;
const BREAKS = ['\n\n', '. ', '! ', '? ', '.\n', '\n'];

function answerOf(chat: ChatState, turnId: string): string {
    return chat.order
        .map((id) => chat.items[id])
        .filter((item): item is Extract<ChatItem, { kind: 'assistant' }> => item?.kind === 'assistant' && item.turnId === turnId && !item.parentToolUseId)
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, MAX_ANSWER_CHARS);
}

/*
 * The turn's own item says how it ended. A long turn's item sits before the page this client holds,
 * so then the chat no longer running it is the end, and an error note in it the only state it shows.
 */
function settledState(chat: ChatState, turnId: string): VoiceChatCompletion['state'] | null {
    const turn = chat.items[turnId];
    if (turn?.kind === 'turn') {
        return turn.state === 'running' ? null : turn.state;
    }
    const own = chat.order.map((id) => chat.items[id]).filter((item) => item?.turnId === turnId);
    if (own.length === 0 || chat.info.activeTurnId === turnId) {
        return null;
    }
    return own.some((item) => item?.kind === 'note' && item.level === 'error') ? 'error' : 'done';
}

export function chatCompletion(chat: ChatState | undefined, turnId: string): VoiceChatCompletion | null {
    if (!chat) {
        return null;
    }
    const state = settledState(chat, turnId);
    return state === null ? null : { state, answer: answerOf(chat, turnId) };
}

/* Cut where a sentence or a paragraph ends, unless that would leave less than half of what fits. */
export function spokenExcerpt(answer: string): { text: string; cut: boolean } {
    if (answer.length <= SPOKEN_ANSWER_CHARS) {
        return { text: answer, cut: false };
    }
    const head = answer.slice(0, SPOKEN_ANSWER_CHARS);
    const end = Math.max(...BREAKS.map((mark) => head.lastIndexOf(mark) + mark.trimEnd().length));
    return { text: end >= SPOKEN_ANSWER_CHARS / 2 ? head.slice(0, end) : `${head}…`, cut: true };
}

export function completionPrompt(followUp: VoiceChatFollowUp, completion: VoiceChatCompletion): string {
    const { text, cut } = spokenExcerpt(completion.answer);
    const result = text || 'The AI Chat returned no final answer.';
    const rest = cut ? `\nThis is only the start of a longer answer. chat.read on ${splitKey(followUp.key).id} reads the rest when the user asks.` : '';
    return `Ruimte completion event. AI Chat “${followUp.chat}”, which you prompted, finished. Project: ${followUp.project ?? 'the original project'}. Its tracked turn ${followUp.turnId} ended with state ${completion.state}. Final answer:\n${result}\nEnd of quoted AI Chat result.${rest}`;
}
