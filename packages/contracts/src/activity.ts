import { z } from 'zod';

/*
 * When a node last changed for a person: its agent started, waited, finished or stopped, or a person
 * opened it. The machine keeps it, so every client lists a canvas in the same order.
 */
export const NodeActivitySchema = z.object({
    projectId: z.string().min(1).max(256),
    nodeId: z.string().min(1).max(256),
    // Epoch ms on the machine's clock.
    at: z.number().int().nonnegative()
});
export type NodeActivity = z.infer<typeof NodeActivitySchema>;

// Every node the machine knows on `activity.list`; only the nodes that changed on `activity.changed`.
export const NodeActivityListSchema = z.object({ activity: z.array(NodeActivitySchema).max(5000) });

// The machine finds the project the node is in; `node-not-found` when it is in none.
export const NodeActivityTouchPayloadSchema = NodeActivitySchema.pick({ nodeId: true });
