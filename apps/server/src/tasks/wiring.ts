import type { Task } from '@ruimte/contracts';
import type { TaskHost } from '../canvas/verb.ts';
import { reportsOnBackgroundWork } from '../chat/background-work.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { chatOpener } from '../chat/wake-chat.ts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, StartAgentEntry } from '../outbox/outbox.ts';
import type { OutboxHandlers } from '../outbox/outbox-worker.ts';
import { backgroundLimitHandler } from './background-limit.ts';
import { giveTaskHandler } from './give-task.ts';
import { TaskCoordinator, type TaskCoordinatorDeps } from './task-coordinator.ts';
import type { TaskStore } from './task-store.ts';
import { chatRequests, deliverWaitingHandler, WaitingObserver } from './waiting-child.ts';
import { oweWake, parkedNote, wakeParentHandler } from './wake-parent.ts';

export interface TaskWiringDeps {
    tasks: TaskStore;
    chats: ChatManager;
    placed(nodeId: string): boolean;
    /* Whether the daemon still owes the turn that carries a task; until it ran, no turn of the child is its answer. */
    owedTurn(taskId: string): boolean;
    titleFor(nodeId: string): string | null;
    madeBy(nodeId: string): string | null;
    /* `notBefore` is when the work is due; now without it. */
    enqueue(projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void>;
    /* Raises attention on a node through the push service, which is also what a client reads marks from. */
    alert(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
    /* Tells the outbox a chat may be free now. */
    wake(chatId: string): void;
    /* When the daemon tries a turn that stopped on an overload again; null when it does not. */
    retryAt?: TaskCoordinatorDeps['retryAt'];
    backgroundLimit: TaskCoordinatorDeps['limit'];
    now?: () => number;
}

export interface TaskWiring {
    coordinator: TaskCoordinator;
    waiting: WaitingObserver;
    host: TaskHost;
    wakeParent: OutboxHandlers['wake-parent'];
    backgroundLimit: OutboxHandlers['background-limit'];
    giveTask: OutboxHandlers['give-task'];
    deliverWaiting: OutboxHandlers['deliver-waiting'];
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
        owedTurn: deps.owedTurn,
        oweWake: (task) => oweWake({ enqueue: deps.enqueue }, task),
        alert: (nodeId, title, body) => deps.alert(deps.chats.get(nodeId) ? 'chat' : 'terminal', nodeId, title, body),
        ...(deps.retryAt ? { retryAt: deps.retryAt } : {}),
        afterBackgroundWork: (chatId) => {
            const chat = deps.chats.get(chatId);
            if (!chat?.running) {
                return 'gone';
            }
            return reportsOnBackgroundWork(chat.info.provider) ? 'reports' : 'silent';
        },
        commandsOf: (chatId) => deps.chats.get(chatId)?.info.background ?? [],
        limit: deps.backgroundLimit
    });

    // Deferred, so a row is never written into a parent from inside the broadcast of the child that settled it.
    deps.tasks.onChange((task: Task) => {
        queueMicrotask(() => deps.chats.syncTaskRow(task));
        // A cancelled task owes no wake of its own, but it may be the last of a team whose held results now go out.
        if (task.status === 'cancelled' && task.batchId !== undefined) {
            deps.wake(task.parentId);
        }
        // However a task ended, the limit on its child's background commands has nothing left to settle.
        if (task.status !== 'open' && deps.backgroundLimit.owed(task.id)) {
            void deps.backgroundLimit.lapse(task.id).catch((e: unknown) => console.error(`Dropping the limit of task ${task.id} failed:`, errorText(e)));
        }
    });

    const requests = chatRequests(deps.chats);
    const waiting = new WaitingObserver({ openTask: (childId) => deps.tasks.openFor(childId), enqueue: deps.enqueue, now });

    deps.chats.observe((event) => {
        coordinator.chatEvent(event);
        waiting.chatEvent(event);
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

    const chatFor = chatOpener({ chats: deps.chats, placed: deps.placed });

    return {
        coordinator,
        waiting,
        host: {
            open: (record) => deps.tasks.open(record, now()),
            give: async (record) => {
                // The record first: the handler reads what the task asks from it, and a restart in between still owes the turn.
                const task = await deps.tasks.open(record, now());
                await deps.enqueue(task.projectId, task.childId, { kind: 'give-task', payload: { taskId: task.id } });
                return task;
            },
            chatState: async (nodeId) => {
                const session = deps.chats.get(nodeId);
                if (session) {
                    return session.info.activeTurnId === null ? 'idle' : 'running';
                }
                // A chat nobody has loaded is idle: the turn opens on the thread the daemon reads back from disk.
                return (await deps.chats.hasStored(nodeId)) ? 'idle' : 'none';
            },
            done: (childId, text) => coordinator.done(childId, text),
            involving: (nodeId) => deps.tasks.involving(nodeId)
        },
        wakeParent: wakeParentHandler({ tasks: deps.tasks, chat: chatFor }),
        backgroundLimit: backgroundLimitHandler({ tasks: deps.tasks, coordinator, chats: deps.chats, placed: deps.placed }),
        giveTask: giveTaskHandler({ tasks: deps.tasks, chat: chatFor, titleFor: deps.titleFor, placed: deps.placed }),
        deliverWaiting: deliverWaitingHandler({
            request: requests.request,
            titleFor: deps.titleFor,
            deliver: (chatId, delivery) => deps.chats.deliverNote(chatId, delivery)
        }),
        onParked: (entry, error) => {
            // A task whose turn never opened is one nobody is working on: it fails, so its chat is not left waiting.
            if (entry.kind === 'give-task') {
                coordinator.giveFailed(entry.target, error);
            }
            onParked(entry, error);
        },
        onStartGaveUp: (entry, error) => {
            coordinator.startFailed(entry.target, error);
            onParked(entry, error);
        },
        prune: async (projectId, ids) => {
            coordinator.cancelled(await deps.tasks.prune(projectId, ids, now()));
        }
    };
};
