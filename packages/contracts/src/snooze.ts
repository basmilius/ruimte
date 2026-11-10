import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

/*
 * A node that needs you, put aside by a person until a moment of their choosing. The machine keeps it,
 * so every client and the push alerts of a phone leave the node alone until it runs out.
 */
export const SnoozeSchema = z.object({
    projectId: z.string().min(1).max(256),
    nodeId: z.string().min(1).max(256),
    // Epoch ms. The client works it out, so "tomorrow at nine" is the morning where the person is.
    until: z.number().int().nonnegative()
});
export type Snooze = z.infer<typeof SnoozeSchema>;

export const SnoozeListSchema = z.object({ snoozes: z.array(SnoozeSchema).max(1000) });

// The machine finds the project the node is in; `node-not-found` when it is in none.
export const SnoozeSetPayloadSchema = SnoozeSchema.pick({ nodeId: true, until: true });
export const SnoozeClearPayloadSchema = SnoozeSchema.pick({ nodeId: true });

export const SNOOZE_REQUEST_SCHEMAS = {
    'snooze.list': { payload: EmptySchema, result: SnoozeListSchema },
    // Setting a moment already past ends the snooze, as clearing it does.
    'snooze.set': { payload: SnoozeSetPayloadSchema, result: EmptySchema },
    'snooze.clear': { payload: SnoozeClearPayloadSchema, result: EmptySchema }
} as const;

export const SNOOZE_EVENT_SCHEMAS = {
    // Every snooze the machine holds, to every client, whenever one is set, cleared or ends.
    'snooze.changed': SnoozeListSchema
} as const;
