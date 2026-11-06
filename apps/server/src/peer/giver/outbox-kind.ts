import { z } from 'zod';
import { StartRemoteAgentPayloadSchema } from '../../canvas/remote-agent-payload.ts';
import { defineOutboxKind } from '../../outbox/kind.ts';

const ConnectPeerSchema = z.object({
    kind: z.literal('connect-peer'),
    // The target is `peer:<machineId>`, the machine whose link is owed. `since` is when it was first owed, which the 7 days count from; `interval` is the wait after the next failure.
    payload: z.object({ machineId: z.string().min(1), since: z.number(), interval: z.number().positive() })
});

const StartRemoteAgentSchema = z.object({
    kind: z.literal('start-remote-agent'),
    // The target is the node here that stands for the agent. What the task asks is in its record (`taskId`); this is where and how it runs there.
    payload: StartRemoteAgentPayloadSchema
});

const StopRemoteAgentSchema = z.object({
    kind: z.literal('stop-remote-agent'),
    // The target is `peer:<machineId>`.
    // `once` is a stop placed after the reconnect gave up: asked over a link that happens to be open, and never the reason to open one.
    payload: z.object({ machineId: z.string().min(1), nodeId: z.string().min(1), once: z.boolean().optional() })
});

const TakeRemoteResultSchema = z.object({
    kind: z.literal('take-remote-result'),
    // The target is the node here that stands for the agent; it is owed from the moment the task started there until its result is taken in.
    // `haves` are the commits of the checkout that was sent, which the work coming back is built on and so leaves out.
    payload: z.object({ machineId: z.string().min(1), taskId: z.string().min(1), haves: z.array(z.string().min(1)).max(20).optional() })
});

/* Owed to a machine, not a node. The reconnect is what the others wait on; it counts the work owed to that machine. */
export const connectPeerKind = defineOutboxKind(ConnectPeerSchema, { outlivesTarget: true });

/* Waits for the link and a place there and never fails the task; an ended node drops it. */
export const startRemoteAgentKind = defineOutboxKind(StartRemoteAgentSchema, {
    owedTo: (payload) => payload.machineId,
    parked: { text: (entry, title, reason) => `The machine could not start the agent in ${title} (${entry.target}) on another machine: ${reason}` }
});

/* Owed because the node or the task is gone, so it outlives any node. */
export const stopRemoteAgentKind = defineOutboxKind(StopRemoteAgentSchema, { outlivesTarget: true, owedTo: (payload) => payload.machineId });

export const takeRemoteResultKind = defineOutboxKind(TakeRemoteResultSchema, {
    owedTo: (payload) => payload.machineId,
    parked: {
        text: (entry, title, reason) => `The machine could not take in the result of the agent in ${title} (${entry.target}) from another machine: ${reason}`
    }
});
