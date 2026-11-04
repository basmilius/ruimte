import { TaskSchema } from '@adecore/agent-contracts/task';
import { z } from 'zod';

export * from '@adecore/agent-contracts/task';

export const TaskListPayloadSchema = z.object({ projectId: z.string().min(1) });

export const TaskListResultSchema = z.object({ tasks: z.array(TaskSchema) });

/*
 * The agents a node opened that are still live, and the ones those opened in turn: what stopping or
 * deleting it ends as well, counted before a person confirms.
 */
export const AgentChildrenPayloadSchema = z.object({ nodeId: z.string().min(1) });

export const AgentChildrenResultSchema = z.object({ nodeIds: z.array(z.string()) });
