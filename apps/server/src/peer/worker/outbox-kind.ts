import { z } from 'zod';
import { defineOutboxKind } from '../../outbox/kind.ts';

const DeliverRemoteResultSchema = z.object({
    kind: z.literal('deliver-remote-result'),
    // The target is `peer:<machineId>`, the machine that gave the task. The entry stays until that machine says it has the result (`peer.result` with `ack`), however long it is away.
    payload: z.object({ machineId: z.string().min(1), nodeId: z.string().min(1), taskId: z.string().min(1) })
});

/* Owed to the machine that gave the task, which no node here stands for. */
export const deliverRemoteResultKind = defineOutboxKind(DeliverRemoteResultSchema, { outlivesTarget: true, owedTo: (payload) => payload.machineId });
