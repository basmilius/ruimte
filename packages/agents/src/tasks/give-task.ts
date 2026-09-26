import type { Task } from '@ruimte/agent-contracts';
import type { WakeChat } from '../chat/wake-chat.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { TaskStore } from './task-store.ts';
import type { GiveTaskEntry } from './task-work.ts';

/* The note above the turn a task opens, so whoever reads the child sees who asked for it. */
export const taskNote = (from: string): string => `Task from ${from}`;

export interface GiveTaskDeps {
    tasks: Pick<TaskStore, 'get'>;
    /* The chat as it is now, loaded from disk when nobody has it; null for a node with no thread. */
    chat(chatId: string): Promise<WakeChat | null>;
    /* What a person calls the node that gave the task, for the note above the turn. */
    titleFor(nodeId: string): string | null;
    /* Whether a project still places the node; one that is gone has its task cancelled by the prune. */
    placed(nodeId: string): boolean;
    /* What the child's CLI is sent: the assignment, and how the host wants to hear back. The prompt alone when absent. */
    assignment?: (task: Task) => string;
}

/*
 * Opens the turn that carries a task given to an agent already running. A turn in the way makes this
 * `wait`, the same as a person's own message, so nothing the host owes steps on what the agent is
 * doing. One agent holds one task at a time, so the task is never queued twice.
 */
export const giveTaskHandler =
    (deps: GiveTaskDeps) =>
    async (entry: GiveTaskEntry): Promise<OutboxOutcome> => {
        const task = deps.tasks.get(entry.payload.taskId);
        // Settled or cancelled before the turn could open, or a node the project no longer places.
        if (!task || task.status !== 'open' || !deps.placed(task.childId)) {
            return;
        }
        const chat = await deps.chat(task.childId);
        if (chat === null) {
            throw new Error(`${task.childId} has no chat to open a turn in`);
        }
        // The turn names the task, so a restart between opening it and dropping this entry gives it once.
        if (chat.items().some((item) => item.kind === 'turn' && (item.taskIds ?? []).includes(task.id))) {
            return;
        }
        const from = deps.titleFor(task.parentId) ?? task.parentId;
        const text = deps.assignment?.(task) ?? task.prompt;
        if (!chat.wake({ text, label: task.title, note: taskNote(from), taskIds: [task.id] })) {
            return 'wait';
        }
    };
