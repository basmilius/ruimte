import type { WakeChat } from '@adecore/agents/chat';
import type { OutboxOutcome } from '@adecore/agents/coordination';
import type { DeliverAnswerEntry } from './outbox.ts';

/* Opens a turn for news written when it happened, which wakes nobody; a chat in a turn, or on its way to another folder, keeps it until it is free. */
export async function wakeWith(
    openChat: (chatId: string) => Promise<WakeChat | null>,
    chatId: string,
    wake: { text: string; label: string }
): Promise<OutboxOutcome> {
    const chat = await openChat(chatId);

    if (chat === null) {
        return;
    }

    if (chat.relocating?.() === true) {
        return 'wait';
    }

    return chat.wake({ text: wake.text, label: wake.label, taskIds: [] }) ? undefined : 'wait';
}

/* A person's answer on a card the chat raised; like a task's result, it is hop 0 and its turn wakes nobody. */
export function deliverAnswerHandler(deps: { openChat(chatId: string): Promise<WakeChat | null> }) {
    return (entry: DeliverAnswerEntry): Promise<OutboxOutcome> => wakeWith(deps.openChat, entry.target, entry.payload);
}
