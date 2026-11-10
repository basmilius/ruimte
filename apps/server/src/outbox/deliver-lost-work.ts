import type { WakeChat } from '@adecore/agents/chat';
import type { OutboxOutcome } from '@adecore/agents/coordination';
import { wakeWith } from './deliver-answer.ts';
import type { DeliverLostWorkEntry } from './outbox.ts';

// The note in front of it says what was lost; the prompt only lets the agent go on from there.
const LOST_WORK_WAKE = { text: 'Go on after the machine restarted.', label: 'Machine restarted' };

interface DeliverLostWorkDeps {
    openChat(chatId: string): Promise<WakeChat | null>;
    /* When the node was ended, such as by stopping the agent that opened it; null while it lives. */
    endedAt(chatId: string): number | null;
    /* Whether the chat still owes the turn for that note: nothing stepped in since. */
    owesWake(chatId: string, noteId: string): boolean;
}

/* Background commands a restart took from an idle chat: the same hop 0 turn as a person's answer, lapsed once anything stepped in since or its node was ended. */
export function deliverLostWorkHandler(deps: DeliverLostWorkDeps) {
    return async (entry: DeliverLostWorkEntry): Promise<OutboxOutcome> => {
        if (deps.endedAt(entry.target) !== null) {
            return;
        }

        // Loaded first, since the session that knows the note only exists then.
        const chat = await deps.openChat(entry.target);

        if (chat === null || !deps.owesWake(entry.target, entry.payload.noteId)) {
            return;
        }

        return wakeWith(deps.openChat, entry.target, LOST_WORK_WAKE);
    };
}
