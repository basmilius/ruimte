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
export type SnoozeList = z.infer<typeof SnoozeListSchema>;

// The machine finds the project the node is in; `node-not-found` when it is in none.
export const SnoozeSetPayloadSchema = SnoozeSchema.pick({ nodeId: true, until: true });
export const SnoozeClearPayloadSchema = SnoozeSchema.pick({ nodeId: true });
