import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import {
    chatWaits,
    turnCompletion,
    waitingPrompt,
    WAITING_COMMENTARY,
    type VoiceChatCompletion,
    type VoiceChatFollowUp,
    type VoiceCompletionDelivery
} from '@ruimte/voice';
import type { VoiceClock } from './clock.ts';

/* How long a chat Voice started may take from its node to the turn its first prompt opens, before Voice says it is not confirmed. */
export const FIRST_TURN_DEADLINE_MS = 60_000;
// Chats one session follows at once; past it the oldest is let go, since a loop of prompts is no conversation.
export const MAX_FOLLOWED = 16;

/* An event of the daemon's chats as an observer hears it; only `chat.event` is read. */
export interface VoiceChatEvent {
    event: string;
    payload: unknown;
}

/* The chats of the daemon as the follower reads them: the events as they go out, and a loaded chat as it stands. */
export interface VoiceFollowChats {
    observe(sink: (event: VoiceChatEvent) => void): () => void;
    /* Null while the machine holds no running chat of that id, as before an agent's chat is made. */
    thread(chatId: string): { items: readonly ChatItem[]; info: Pick<ChatInfo, 'status' | 'activeTurnId'> } | null;
}

/* A line of the phone's timeline; never what a chat said. */
export interface VoiceFollowActivity {
    id: string;
    label: string;
    status: 'running' | 'completed' | 'failed';
}

export interface VoiceFollowerDeps {
    chats: VoiceFollowChats;
    delivery: Pick<VoiceCompletionDelivery, 'enqueue' | 'report' | 'cancelChat'>;
    clock: VoiceClock;
    activity(entry: VoiceFollowActivity): void;
}

/* Where a chat stands in the eyes of Voice, by name, to say which one it means. */
export interface VoiceFollowedChat {
    chat: string;
    project: string;
}

/* Taken before a prompt goes out, so no turn it opens can end unheard; bound to the turn once the chat names it. */
export interface VoicePromptTicket {
    bind(turnId: string): void;
    drop(): void;
}

/* Taken before a start, bound to the node the start made. */
export interface VoiceStartTicket {
    bind(chatId: string, chat: VoiceFollowedChat): void;
    drop(): void;
}

/* What the actions of a session reach the follower through. */
export interface VoiceFollowHost {
    expectPrompt(chatId: string, chat: VoiceFollowedChat): VoicePromptTicket;
    expectStart(): VoiceStartTicket;
    /* A chat Voice cleared: what was followed in it and what waits to be told of it go. */
    cleared(chatId: string): void;
}

interface Followed {
    chatId: string;
    named: VoiceFollowedChat;
    /* Null until the chat names the turn: a prompt's once its send answers, a start's once its first turn opens. */
    turnId: string | null;
    start: { step: 'created' | 'ready' | 'accepted'; cancelDeadline: () => void } | null;
    /* How often the turn waited on the person, so each wait is told once and a later one again. */
    waits: number;
    waiting: boolean;
}

const UNCONFIRMED_COMMENTARY =
    'The status event just supplied says an AI Chat you started has not confirmed its first turn. Tell the user now that it was made but its first turn is not confirmed yet. Do not wait for another user message.';

/*
 * Follows the chats a Voice session prompted or started, through the daemon's own chat events, and tells
 * the session when the turn it set going ends, fails or waits on the person. A turn is the one the chat
 * named for that prompt, never the next one that happens to end, and an idle chat is no finished turn.
 * Like the push service it is an observer that only notes: it wakes no chat and answers nothing.
 */
export class VoiceFollower implements VoiceFollowHost {
    readonly #deps: VoiceFollowerDeps;
    readonly #followed = new Map<string, Followed>();
    #unsubscribe: (() => void) | null;
    #tickets = 0;
    // A start or a send still running when the session ended binds its ticket late; it follows nothing then.
    #stopped = false;

    constructor(deps: VoiceFollowerDeps) {
        this.#deps = deps;
        this.#unsubscribe = deps.chats.observe((event) => this.#heard(event));
    }

    expectPrompt(chatId: string, chat: VoiceFollowedChat): VoicePromptTicket {
        const entry = this.#follow({ chatId, named: chat, turnId: null, start: null, waits: 0, waiting: false });
        return {
            bind: (turnId) => {
                if (this.#stopped || this.#followed.get(chatId) !== entry) {
                    return;
                }
                entry.turnId = turnId;
                this.#look(chatId);
            },
            drop: () => this.#forget(chatId, entry)
        };
    }

    expectStart(): VoiceStartTicket {
        let entry: Followed | null = null;
        let dropped = false;
        return {
            bind: (chatId, chat) => {
                if (this.#stopped || dropped || entry !== null) {
                    return;
                }
                const id = `start-${++this.#tickets}`;
                const start: NonNullable<Followed['start']> = { step: 'created', cancelDeadline: () => undefined };
                const made: Followed = { chatId, named: chat, turnId: null, start, waits: 0, waiting: false };
                entry = made;
                this.#follow(made);
                this.#deps.activity({ id: `${id}-made`, label: `Started “${chat.chat}”`, status: 'completed' });
                start.cancelDeadline = this.#deps.clock.after(FIRST_TURN_DEADLINE_MS, () => this.#unconfirmed(made));
                this.#look(chatId);
            },
            drop: () => {
                dropped = true;
                if (entry !== null) {
                    this.#forget(entry.chatId, entry);
                }
            }
        };
    }

    cleared(chatId: string): void {
        const entry = this.#followed.get(chatId);
        if (entry !== undefined) {
            this.#forget(chatId, entry);
        }
        this.#deps.delivery.cancelChat(chatId);
    }

    get size(): number {
        return this.#followed.size;
    }

    /* The session ended: nothing more is told, and what still runs keeps running. */
    stop(): void {
        this.#stopped = true;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        for (const entry of this.#followed.values()) {
            entry.start?.cancelDeadline();
        }
        this.#followed.clear();
    }

    #follow(entry: Followed): Followed {
        if (this.#stopped) {
            return entry;
        }
        const known = this.#followed.get(entry.chatId);
        if (known !== undefined) {
            // A newer prompt to the same chat is the one Voice waits on; the earlier turn was told when it was asked about.
            this.#forget(entry.chatId, known);
        }
        if (this.#followed.size >= MAX_FOLLOWED) {
            const [oldestId, oldest] = this.#followed.entries().next().value!;
            this.#forget(oldestId, oldest);
        }
        this.#followed.set(entry.chatId, entry);
        return entry;
    }

    #forget(chatId: string, entry: Followed): void {
        if (this.#followed.get(chatId) === entry) {
            entry.start?.cancelDeadline();
            this.#followed.delete(chatId);
        }
    }

    #heard(event: VoiceChatEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }
        const payload = event.payload as { chatId?: unknown; event?: { type?: unknown } };
        const type = payload.event?.type;
        // A delta only grows a reply that the next item states whole; what ends or holds a turn comes as an item or an info.
        if (typeof payload.chatId === 'string' && (type === 'item' || type === 'info' || type === 'reset')) {
            this.#look(payload.chatId);
        }
    }

    #look(chatId: string): void {
        const entry = this.#followed.get(chatId);
        const thread = entry === undefined ? null : this.#deps.chats.thread(chatId);
        if (entry === undefined || thread === null) {
            return;
        }
        const { start } = entry;
        if (start !== null && start.step === 'created') {
            start.step = 'ready';
            this.#deps.activity({ id: `${chatId}-ready`, label: `“${entry.named.chat}” is running`, status: 'completed' });
        }
        if (start !== null && entry.turnId === null) {
            // The chat is new, so the first turn in its thread is the one its first prompt opened.
            const first = thread.items.find((item) => item.kind === 'turn');
            if (first === undefined) {
                return;
            }
            entry.turnId = first.id;
            start.step = 'accepted';
            start.cancelDeadline();
            this.#deps.activity({ id: `${chatId}-accepted`, label: `“${entry.named.chat}” took its first prompt`, status: 'completed' });
        }
        if (entry.turnId === null) {
            return;
        }
        const completion = turnCompletion({ items: thread.items, activeTurnId: thread.info.activeTurnId }, entry.turnId);
        if (completion !== null) {
            this.#settled(entry, completion);
            return;
        }
        const waiting = thread.info.status === 'needs-you' && thread.info.activeTurnId === entry.turnId;
        if (waiting && !entry.waiting) {
            entry.waits += 1;
            const session = { key: chatId, kind: 'chat' as const, name: entry.named.chat, project: entry.named.project };
            this.#deps.delivery.report(
                `${chatId}:${entry.turnId}:wait-${entry.waits}`,
                chatId,
                waitingPrompt(session, chatWaits(thread.items)),
                WAITING_COMMENTARY
            );
        }
        entry.waiting = waiting;
    }

    #settled(entry: Followed, completion: VoiceChatCompletion): void {
        this.#forget(entry.chatId, entry);
        const followUp: VoiceChatFollowUp = {
            key: entry.chatId,
            chatId: entry.chatId,
            chat: entry.named.chat,
            project: entry.named.project,
            turnId: entry.turnId!
        };
        this.#deps.delivery.enqueue(followUp, completion);
        this.#deps.activity({
            id: `${entry.chatId}-${entry.turnId}`,
            label: `“${entry.named.chat}” ${completion.state === 'done' ? 'finished' : completion.state === 'aborted' ? 'was stopped' : 'failed'}`,
            status: completion.state === 'done' ? 'completed' : 'failed'
        });
    }

    #unconfirmed(entry: Followed): void {
        if (this.#followed.get(entry.chatId) !== entry || entry.turnId !== null) {
            return;
        }
        this.#forget(entry.chatId, entry);
        const seconds = Math.round(FIRST_TURN_DEADLINE_MS / 1000);
        this.#deps.delivery.report(
            `${entry.chatId}:unconfirmed`,
            entry.chatId,
            `Ruimte status event. The AI Chat “${entry.named.chat}” you started in project ${entry.named.project} was made, but its first turn did not start within ${seconds} seconds. It may still be starting; agents.inspect or chat.inspect reads where it stands.`,
            UNCONFIRMED_COMMENTARY
        );
        this.#deps.activity({ id: `${entry.chatId}-unconfirmed`, label: `“${entry.named.chat}” did not confirm its first turn`, status: 'failed' });
    }
}
