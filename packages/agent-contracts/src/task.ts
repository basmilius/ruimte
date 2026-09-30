import { z } from 'zod';

export const TaskStatusSchema = z.enum(['open', 'done', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskResultSchema = z.object({
    text: z.string(),
    // How the result came about: the child called `done`, its first turn ended, or its process left.
    source: z.enum(['done', 'turn', 'exit']),
    at: z.number()
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

/*
 * What a chat asked of a node it opened with `--task`, kept by the host under its data folder rather
 * than anywhere an agent can write: waking the parent is a promise the host keeps.
 */
export const TaskSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    parentId: z.string().min(1),
    childId: z.string().min(1),
    title: z.string(),
    prompt: z.string(),
    // The one `team --task` call it came from: the parent is woken about that call once every task of it settled.
    batchId: z.string().min(1).optional(),
    requiresTaskTurn: z.boolean().optional(),
    background: z.object({ turnId: z.string(), itemIds: z.array(z.string()), commands: z.array(z.string()) }).optional(),
    status: TaskStatusSchema,
    result: TaskResultSchema.nullable(),
    createdAt: z.number(),
    settledAt: z.number().nullable(),
    // Whether the parent has been woken about this task yet; `none` for a task that never wakes anybody.
    wake: z.enum(['pending', 'sent', 'none']),
    // Set while the child's last turn stopped on a limit: the task stays open and wakes nobody, `until` the limit lifts when known.
    paused: z.object({ kind: z.enum(['usage', 'overload']), until: z.number().optional() }).optional()
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskChangedEventSchema = z.object({ task: TaskSchema });
export type TaskChangedEvent = z.infer<typeof TaskChangedEventSchema>;
