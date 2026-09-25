import { commandLabel, runningInBackground } from '../chat/background-work.ts';
import { loadChat, type ChatOpenerDeps } from '../chat/wake-chat.ts';
import type { BackgroundLimitEntry } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { TaskCoordinator } from './task-coordinator.ts';
import type { TaskStore } from './task-store.ts';

export interface BackgroundLimitDeps extends ChatOpenerDeps {
    tasks: Pick<TaskStore, 'get'>;
    coordinator: Pick<TaskCoordinator, 'outlasted'>;
}

/*
 * The limit on a child's background commands passed. Its task settles on the child's last turn, unless
 * something else settled it first or a subagent or a workflow now holds it, which has no limit; a turn
 * in flight may still answer it, so the limit looks again once that turn ended.
 */
export const backgroundLimitHandler =
    (deps: BackgroundLimitDeps) =>
    async (entry: BackgroundLimitEntry): Promise<OutboxOutcome> => {
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
        await deps.coordinator.outlasted(entry.target, running.length > 0 ? running : entry.payload.commands);
    };
