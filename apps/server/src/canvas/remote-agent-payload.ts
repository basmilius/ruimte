import { AgentKindSchema, RuntimeModeSchema } from '@ruimte/contracts';
import { z } from 'zod';

/* Where and how a task runs on another machine; the target of its outbox entry is the node here that stands for the agent. */
export const StartRemoteAgentPayloadSchema = z.object({
    machineId: z.string().min(1),
    remoteProjectId: z.string().min(1),
    taskId: z.string().min(1),
    node: z.enum(['chat', 'terminal']),
    provider: AgentKindSchema,
    // The node here that gave the task, which that machine counts its agents under.
    parentId: z.string().min(1),
    // What the tool asked and the mode its parent has; that machine narrows both again.
    mode: RuntimeModeSchema.optional(),
    ceiling: RuntimeModeSchema,
    depth: z.number().int().min(0),
    // With a worktree there: the checkout here that is sent over, and the branch it becomes. Both or neither.
    source: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    // Set before `peer.taskStart` goes out and cleared on a refusal, so dropping the entry knows whether an agent may run there.
    sent: z.boolean().optional()
});

export type StartRemoteAgentPayload = z.infer<typeof StartRemoteAgentPayloadSchema>;
