import { errorText } from '../error-text.ts';
import type { OutboxEntry } from '../outbox/outbox.ts';

export interface ParkedNoteDeps {
    /* The chat that opened a node, or null for a node a person opened. */
    madeBy(nodeId: string): string | null;
    titleFor(nodeId: string): string | null;
    note(chatId: string, text: string): Promise<void>;
    /* Raises attention on a node, for a person who has to step in. */
    alert(nodeId: string, body: string): void;
}

/* What the chat is told about work that was given up on, in the words of the kind it was. */
const parkedText = (entry: OutboxEntry, title: string, reason: string): string => {
    switch (entry.kind) {
        case 'wake-parent':
            return `The machine could not wake this chat with the results of its tasks: ${reason}`;
        case 'start-agent':
            return `The machine could not start the agent in ${title} (${entry.target}): ${reason}`;
        case 'give-task':
            return `The machine could not give a task to ${title} (${entry.target}): ${reason}`;
        case 'deliver-message':
            return `The machine could not give ${title} (${entry.target}) a turn on the message it was sent: ${reason}`;
        case 'resume-limit':
            return `The machine could not take up ${title} (${entry.target}) again after its limit: ${reason}`;
        case 'background-limit':
            return `The machine could not settle the task of ${title} (${entry.target}) once its background commands ran too long: ${reason}`;
        default:
            return `The machine could not resume the turn of ${title} (${entry.target}) after a restart: ${reason}`;
    }
};

/*
 * A piece of owed work the daemon gave up on is said in the thread of the chat it was for: the chat
 * that opened the node, or the chat a wake was for. Only in a chat, since a terminal has no thread.
 */
export const parkedNote =
    (deps: ParkedNoteDeps) =>
    (entry: OutboxEntry, error: unknown): void => {
        // A summary that was not delivered is said in its fork, by its own handler; a note about a waiting child was only news.
        if (entry.kind === 'deliver-summary' || entry.kind === 'deliver-waiting') {
            return;
        }
        /* A message is nobody's to answer for but the chat it was left for, which has no opener in this. */
        const chatId = entry.kind === 'wake-parent' || entry.kind === 'deliver-message' ? entry.target : deps.madeBy(entry.target);
        if (chatId === null) {
            return;
        }
        const title = deps.titleFor(entry.target) ?? entry.target;
        const reason = errorText(error);
        const text = parkedText(entry, title, reason);
        void deps.note(chatId, text).catch((e: unknown) => console.error(`Leaving a note in ${chatId} failed:`, errorText(e)));
        if (entry.kind === 'wake-parent') {
            deps.alert(chatId, text);
        }
    };
