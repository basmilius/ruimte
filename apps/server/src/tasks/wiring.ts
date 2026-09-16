import type { Task } from '@ruimte/contracts';
import type { TaskHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { OutboxEntry, OutboxWork, StartAgentEntry } from '../outbox/outbox.ts';
import type { OutboxHandlers } from '../outbox/outbox-worker.ts';
import { TaskCoordinator } from './task-coordinator.ts';
import type { TaskStore } from './task-store.ts';
import { oweWake, parkedNote, wakeParentHandler } from './wake-parent.ts';

export interface TaskWiringDeps {
    tasks: TaskStore;
    chats: ChatManager;
    placed(nodeId: string): boolean;
    titleFor(nodeId: string): string | null;
    madeBy(nodeId: string): string | null;
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    /* Raises attention on a node through the push service, which is also what a client reads marks from. */
    alert(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
    /* Tells the outbox a chat may be free now. */
    wake(chatId: string): void;
    now?: () => number;
}

export interface TaskWiring {
    coordinator: TaskCoordinator;
    host: TaskHost;
    wakeParent: OutboxHandlers['wake-parent'];
    onParked(entry: OutboxEntry, error: unknown): void;
    onStartGaveUp(entry: StartAgentEntry, error: unknown): void;
    /* What the daemon does with the child's own prune of the project: cancel, then look at the parents again. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void>;
}

/*
 * The tasks of the daemon in one place, so `daemon.ts` only hands in what it has: the coordinator that
 * settles, the wake the outbox runs, the rows in a parent's thread and what the verbs reach.
 */
export const wireTasks = (deps: TaskWiringDeps): TaskWiring => {
    const now = deps.now ?? Date.now;
    const coordinator = new TaskCoordinator({
        tasks: deps.tasks,
        now,
        chatItems: (chatId) => deps.chats.get(chatId)?.thread.list() ?? null,
        placed: deps.placed,
        oweWake: (task) => oweWake({ enqueue: deps.enqueue }, task),
        alert: (nodeId, title, body) => deps.alert(deps.chats.get(nodeId) ? 'chat' : 'terminal', nodeId, title, body)
    });

    // Deferred, so a row is never written into a parent from inside the broadcast of the child that settled it.
    deps.tasks.onChange((task: Task) => {
        queueMicrotask(() => deps.chats.syncTaskRow(task));
        // A cancelled task owes no wake of its own, but it may be the last of a team whose held results now go out.
        if (task.status === 'cancelled' && task.batchId !== undefined) {
            deps.wake(task.parentId);
        }
    });

    deps.chats.observe((event) => {
        coordinator.chatEvent(event);
        if (event.event === 'chat.event' && deps.chats.get(event.payload.chatId)?.info.activeTurnId === null) {
            deps.wake(event.payload.chatId);
        }
    });

    const onParked = parkedNote({
        madeBy: deps.madeBy,
        titleFor: deps.titleFor,
        note: (chatId, text) => deps.chats.addNote(chatId, 'warning', text),
        alert: (chatId, text) => deps.alert('chat', chatId, 'Could not wake the chat', text)
    });

    return {
        coordinator,
        host: {
            open: (record) => deps.tasks.open(record, now()),
            done: (childId, text) => coordinator.done(childId, text),
            involving: (nodeId) => deps.tasks.involving(nodeId)
        },
        wakeParent: wakeParentHandler({
            tasks: deps.tasks,
            chat: async (chatId) => {
                if (!deps.chats.get(chatId)) {
                    if (!deps.placed(chatId) || !(await deps.chats.hasStored(chatId))) {
                        return null;
                    }
                    await deps.chats.create({ chatId });
                }
                const session = deps.chats.get(chatId);
                return session
                    ? {
                          items: () => session.thread.list(),
                          wake: (wake) => session.wake(wake) !== null
                      }
                    : null;
            }
        }),
        onParked,
        onStartGaveUp: (entry, error) => {
            coordinator.startFailed(entry.target, error);
            onParked(entry, error);
        },
        prune: async (projectId, ids) => {
            coordinator.cancelled(await deps.tasks.prune(projectId, ids, now()));
        }
    };
};
