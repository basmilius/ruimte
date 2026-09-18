import type { ChatItem } from '@ruimte/contracts';
import type { WakeChat } from '../chat/wake-chat.ts';
import type { DeliverMessageEntry } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { Notice, NoticeStore } from './notices.ts';

/*
 * What the CLI is sent under the messages themselves, which the preamble of this turn carries. The
 * last sentence is the rule the daemon enforces a moment later: without it an agent answers and then
 * waits for a reply that only comes when a person prompts the other side.
 */
export const messageText = (count: number): string =>
    `${count === 1 ? 'A node linked to you sent you the message above' : `${count} nodes linked to you sent you the messages above`}. Act on it, and answer with ruimte-context notify if you were asked something. A message starts one turn and no further: what you send from this turn is read by that node at the start of its next one.`;

/* What a person reads above the turn in the thread: who it came from, by the name they see on the canvas. */
export const messageLabel = (notices: readonly Notice[]): string => {
    const names = [...new Set(notices.map((notice) => (notice.fromTitle === '' ? `node ${notice.from}` : notice.fromTitle)))];
    return names.length === 1 ? `Message from ${names[0]}` : `Messages from ${names.join(', ')}`;
};

/*
 * Whether the turn a chat is running was itself opened by a message. This is the whole of the stop:
 * two agents that read each other would otherwise wake each other for as long as they kept writing,
 * and nothing about that started with a person. It rides on the turn, so it survives a restart.
 */
export const turnFromMessage = (items: readonly ChatItem[], activeTurnId: string | null): boolean => {
    if (activeTurnId === null) {
        return false;
    }
    const turn = items.find((item) => item.id === activeTurnId);
    return turn?.kind === 'turn' && (turn.messageFrom ?? []).length > 0;
};

export interface DeliverMessageDeps {
    notices: Pick<NoticeStore, 'waiting'>;
    /* The chat the message was left for, loaded from disk when nobody has it; null for a node with no thread. */
    chat(chatId: string): Promise<WakeChat | null>;
    /* Whether a project still places the node; one that is gone reads nothing any more. */
    placed(nodeId: string): boolean;
}

/*
 * Opens the turn a message earns a chat. The messages themselves are not carried here: they wait in
 * the notice store and the turn's preamble takes them, the same channel a person's own prompt reads
 * them through, so one message is heard once whichever of the two opens the turn.
 *
 * One attempt, never `wait`. A chat that turned out to be in a turn reads the message in front of its
 * next one, which is what a message to a busy chat has always done; holding the entry instead would
 * make the daemon start turns nobody asked for long after the news was worth anything.
 */
export const deliverMessageHandler =
    (deps: DeliverMessageDeps) =>
    async (entry: DeliverMessageEntry): Promise<OutboxOutcome> => {
        if (!deps.placed(entry.target)) {
            return;
        }
        const waiting = deps.notices.waiting(entry.target);
        // A turn opened for an earlier message took these along, or they went stale: nothing to wake anyone for.
        if (waiting.length === 0) {
            return;
        }
        const chat = await deps.chat(entry.target);
        if (chat === null) {
            return;
        }
        /*
         * No note of its own, and the preamble stays off the thread. A person read the message as it
         * landed (`showNotices`), so anything the turn adds about it only says the same thing again;
         * the label on the turn already names who it came from.
         */
        chat.wake({
            text: messageText(waiting.length),
            label: messageLabel(waiting),
            taskIds: [],
            messageFrom: [...new Set(waiting.map((notice) => notice.from))]
        });
    };
