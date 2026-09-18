import { taskBrief } from '../canvas/task-verbs.ts';
import type { GiveTaskEntry } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { TaskStore } from './task-store.ts';
import type { WakeChat } from './wake-parent.ts';

/* The note above the turn a task opens, so a person reading the child sees who asked it for this. */
export const taskNote = (from: string): string => `Task from ${from}`;

/* What the child's CLI is sent: the assignment, with the same line under it a child opened with a task reads. */
export const taskText = (prompt: string): string => `${prompt}${taskBrief(true)}`;

export interface GiveTaskDeps {
    tasks: Pick<TaskStore, 'get'>;
    /* The chat as it is now, loaded from disk when nobody has it; null for a node with no thread. */
    chat(chatId: string): Promise<WakeChat | null>;
    /* What a person calls the node that gave the task, for the note above the turn. */
    titleFor(nodeId: string): string | null;
    /* Whether a project still places the node; one that is gone has its task cancelled by the prune. */
    placed(nodeId: string): boolean;
}

/*
 * Opens the turn that carries a task given to an agent that was already running. A turn in the way
 * makes it `wait`, which is what a person's own message does while a chat works: it goes out when
 * that turn ends, so nothing the daemon owes ever steps on what the agent is doing. The task is
 * never queued twice over, since one agent holds one task at a time.
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
        if (!chat.wake({ text: taskText(task.prompt), label: task.title, note: taskNote(from), taskIds: [task.id] })) {
            return 'wait';
        }
    };
