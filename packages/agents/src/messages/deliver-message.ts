import { z } from 'zod';
import type { WakeChat } from '../chat/wake-chat.ts';
import type { OutboxEntryOf } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { MessageWords } from './deliver-notice.ts';
import type { NoticeStore } from './notice-store.ts';

export const DeliverMessageWorkSchema = z.object({
    kind: z.literal('deliver-message'),
    // The target is the chat the message was left for; the message itself waits in the notice store, with any that came in beside it.
    payload: z.object({ from: z.string().min(1) })
});

export type DeliverMessageWork = z.infer<typeof DeliverMessageWorkSchema>;
export type DeliverMessageEntry = OutboxEntryOf<DeliverMessageWork>;

export interface DeliverMessageDeps {
    notices: Pick<NoticeStore, 'waiting'>;
    /* The chat the message was left for, loaded from disk when nobody has it; null for a node with no thread. */
    chat(chatId: string): Promise<WakeChat | null>;
    /* Whether a project still places the node; one that is gone reads nothing any more. */
    placed(nodeId: string): boolean;
    words: Pick<MessageWords, 'prompt' | 'label'>;
}

/*
 * Opens the turn a message earns a chat. The messages themselves are not carried here: they wait in
 * the notice store and the turn's preamble takes them (`NoticeNotes`), the same channel a person's
 * own prompt reads them through, so one message is heard once whichever of the two opens the turn.
 *
 * One attempt, never `wait`. A chat that turned out to be in a turn reads the message in front of its
 * next one, which is what a message to a busy chat has always done; holding the entry instead would
 * make the host start turns nobody asked for long after the news was worth anything.
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
            text: deps.words.prompt(waiting.length),
            label: deps.words.label(waiting),
            taskIds: [],
            messageFrom: [...new Set(waiting.map((notice) => notice.from))]
        });
    };
