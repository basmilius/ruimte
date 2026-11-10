import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema } from '@adecore/agents/coordination';
import { defineOutboxKind } from '../kind.ts';

export const wakeParentKind = defineOutboxKind(WakeParentWorkSchema, {
    parked: {
        chat: 'target',
        alert: true,
        text: (_entry, _title, reason) => `The machine could not wake this chat with the results of its tasks: ${reason}`
    }
});

export const giveTaskKind = defineOutboxKind(GiveTaskWorkSchema, {
    parked: { text: (entry, title, reason) => `The machine could not give a task to ${title} (${entry.target}): ${reason}` }
});

export const backgroundLimitKind = defineOutboxKind(BackgroundLimitWorkSchema, {
    parked: {
        text: (entry, title, reason) =>
            `The machine could not settle the task of ${title} (${entry.target}) once its background commands ran too long: ${reason}`
    }
});

/* A note about a waiting child was only news. */
export const deliverWaitingKind = defineOutboxKind(DeliverWaitingWorkSchema);
