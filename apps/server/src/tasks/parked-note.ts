import { errorText } from '../error-text.ts';
import { traitsOf } from '../outbox/kinds.ts';
import type { OutboxEntry } from '../outbox/outbox.ts';

interface ParkedNoteDeps {
    /* The chat that opened a node, or null for a node a person opened. */
    madeBy(nodeId: string): string | null;
    titleFor(nodeId: string): string | null;
    note(chatId: string, text: string): Promise<void>;
    /* Raises attention on a node, for a person who has to step in. */
    alert(nodeId: string, body: string): void;
}

/*
 * A piece of owed work the daemon gave up on is said in the thread of the chat it was for, in the words
 * its kind has for that (`parked` of its descriptor): the chat that opened the node, or the chat the
 * entry is about. A kind with no words says nothing. Only in a chat, since a terminal has no thread.
 */
export function parkedNote(deps: ParkedNoteDeps) {
    return (entry: OutboxEntry, error: unknown): void => {
        const parked = traitsOf(entry.kind).parked;
        if (parked === undefined) {
            return;
        }
        const chatId = parked.chat === 'target' ? entry.target : deps.madeBy(entry.target);
        if (chatId === null) {
            return;
        }
        const text = parked.text(entry, deps.titleFor(entry.target) ?? entry.target, errorText(error));
        void deps.note(chatId, text).catch((e: unknown) => console.error(`Leaving a note in ${chatId} failed:`, errorText(e)));
        if (parked.alert === true) {
            deps.alert(chatId, text);
        }
    };
}
