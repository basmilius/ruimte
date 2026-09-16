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
 * What a chat asked of a node it opened with `--task`, kept by the daemon under `$RUIMTE_HOME/tasks`
 * rather than in `project.json`: waking the parent is a promise the machine keeps.
 */
export const TaskSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    parentId: z.string().min(1),
    childId: z.string().min(1),
    title: z.string(),
    prompt: z.string(),
    status: TaskStatusSchema,
    result: TaskResultSchema.nullable(),
    createdAt: z.number(),
    settledAt: z.number().nullable(),
    // Whether the parent has been woken about this task yet; `none` for a task that never wakes anybody.
    wake: z.enum(['pending', 'sent', 'none'])
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskListPayloadSchema = z.object({ projectId: z.string().min(1) });
export type TaskListPayload = z.infer<typeof TaskListPayloadSchema>;

export const TaskListResultSchema = z.object({ tasks: z.array(TaskSchema) });
export type TaskListResult = z.infer<typeof TaskListResultSchema>;

export const TaskChangedEventSchema = z.object({ task: TaskSchema });
export type TaskChangedEvent = z.infer<typeof TaskChangedEventSchema>;
