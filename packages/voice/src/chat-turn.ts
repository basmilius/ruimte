import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { turnCompletion, type VoiceChatCompletion } from './follow-up.ts';
import { chatWaits } from './session-watch.ts';

/* A chat as a runner holds it: its thread in thread order, and what the chat says of itself now. */
export interface VoiceChatState {
    items: readonly ChatItem[];
    info: Pick<ChatInfo, 'status' | 'activeTurnId'>;
}

export type ChatTurnProgress = { kind: 'settled'; completion: VoiceChatCompletion } | { kind: 'running'; waiting: boolean };

/*
 * Where the turn Voice set going stands. A turn is the one the chat named for that prompt, never the next
 * one that happens to end, and an idle chat is no finished turn. It waits on the person only while the
 * chat runs this very turn and asks for them.
 */
export function chatTurnProgress(chat: VoiceChatState, turnId: string): ChatTurnProgress {
    const completion = turnCompletion({ items: chat.items, activeTurnId: chat.info.activeTurnId }, turnId);
    if (completion !== null) {
        return { kind: 'settled', completion };
    }
    return { kind: 'running', waiting: chat.info.status === 'needs-you' && chat.info.activeTurnId === turnId };
}

/* While the chat still runs the turn, its thread cannot have settled it, so a runner that has to fetch the thread need not. */
export function chatRunsTurn(info: Pick<ChatInfo, 'activeTurnId'>, turnId: string): boolean {
    return info.activeTurnId === turnId;
}

/* What a runner tells the session after it looked at the chat again. */
export type FollowedTurnStep =
    | { kind: 'settled'; completion: VoiceChatCompletion }
    /* The turn started waiting on the person; `count` numbers the waits of this turn, so each is told once and a later one again. */
    | { kind: 'waits'; count: number; waits: string[] }
    | { kind: 'quiet' };

/* One turn followed to its end, for a runner that looks at the chat on each of its events. */
export class FollowedTurn {
    readonly turnId: string;
    #waits = 0;
    #waiting = false;

    constructor(turnId: string) {
        this.turnId = turnId;
    }

    observe(chat: VoiceChatState): FollowedTurnStep {
        const progress = chatTurnProgress(chat, this.turnId);
        if (progress.kind === 'settled') {
            return progress;
        }
        const starts = progress.waiting && !this.#waiting;
        this.#waiting = progress.waiting;
        if (!starts) {
            return { kind: 'quiet' };
        }
        this.#waits += 1;
        return { kind: 'waits', count: this.#waits, waits: chatWaits(chat.items) };
    }
}
