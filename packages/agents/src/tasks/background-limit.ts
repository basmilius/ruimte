import { commandLabel, runningInBackground } from '../chat/background-work.ts';
import { loadChat, type ChatOpenerDeps } from '../chat/wake-chat.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { TaskCoordinator, TaskCoordinatorDeps } from './task-coordinator.ts';
import type { TaskStore } from './task-store.ts';
import { isBackgroundLimit, type AnyOutboxEntry, type BackgroundLimitEntry, type TaskOutbox } from './task-work.ts';

export interface BackgroundLimitDeps extends ChatOpenerDeps {
    tasks: Pick<TaskStore, 'get'>;
    coordinator: Pick<TaskCoordinator, 'outlasted'>;
}

/*
 * The limit on a child's background commands passed, or a restart took them down. Its task settles on
 * the child's last turn (failed after a restart), unless something else settled it first or a subagent
 * or a workflow now holds it, which has no limit; a turn in flight may still answer it, so the limit
 * looks again once that turn ended.
 */
export function backgroundLimitHandler(deps: BackgroundLimitDeps) {
    return async (entry: BackgroundLimitEntry): Promise<OutboxOutcome> => {
        if (deps.tasks.get(entry.payload.taskId)?.status !== 'open') {
            return;
        }
        const chat = await loadChat(deps, entry.target);
        if (chat === null) {
            return;
        }
        if (chat.info.activeTurnId !== null) {
            return 'wait';
        }
        if (runningInBackground(chat.thread.list()).length > 0) {
            return;
        }
        // A child whose process went since the limit started runs nothing any more; what it ran then is what the parent is told.
        const running = (chat.info.background ?? []).map(commandLabel);
        await deps.coordinator.outlasted(entry.target, running.length > 0 ? running : entry.payload.commands, entry.payload.restarted ? 'restart' : 'limit');
    };
}

export interface RestartedOutbox {
    list(): readonly AnyOutboxEntry[];
    update(entry: BackgroundLimitEntry): Promise<void>;
}

/*
 * Every limit still owed when the host starts was owed by an earlier run, and the CLI whose commands
 * it waits on went down with that run, so nothing is left to wait for: each is due now and fails its
 * task. Call after the outbox loaded and before its worker starts.
 */
export async function restartBackgroundLimits(outbox: RestartedOutbox, now: number): Promise<void> {
    for (const entry of outbox.list()) {
        if (isBackgroundLimit(entry)) {
            await outbox.update({ ...entry, notBefore: now, payload: { ...entry.payload, restarted: true } });
        }
    }
}

/* The `background-limit` entries of a host's outbox, one per task at most, as the coordinator owes and drops them. */
export function backgroundLimits(outbox: Pick<TaskOutbox, 'list' | 'enqueue' | 'remove'>): TaskCoordinatorDeps['limit'] {
    return {
        owed: (taskId) => outbox.list().some((entry) => isBackgroundLimit(entry) && entry.payload.taskId === taskId),
        owe: (task, commands, at) =>
            outbox.enqueue(task.projectId, task.childId, { kind: 'background-limit', payload: { taskId: task.id, commands: [...commands] } }, at),
        lapse: async (taskId) => {
            for (const entry of outbox.list()) {
                if (isBackgroundLimit(entry) && entry.payload.taskId === taskId) {
                    await outbox.remove(entry.id);
                }
            }
        }
    };
}
