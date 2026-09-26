import type { Task } from '@ruimte/agent-contracts';
import { reportsOnBackgroundWork } from '../chat/background-work.ts';
import type { ChatCore } from '../chat/chat-core.ts';
import { chatOpener } from '../chat/wake-chat.ts';
import { errorText } from '../error-text.ts';
import type { OutboxHandlers } from '../outbox/outbox-worker.ts';
import { backgroundLimitHandler, backgroundLimits } from './background-limit.ts';
import { giveTaskHandler } from './give-task.ts';
import { TaskCoordinator, type TaskCoordinatorDeps } from './task-coordinator.ts';
import type { TaskStore } from './task-store.ts';
import { isGiveTask, type AnyOutboxEntry, type TaskOutbox, type TaskWork } from './task-work.ts';
import { chatRequests, deliverWaitingHandler, WaitingObserver, type ChatRequests, type WaitingWords } from './waiting-child.ts';
import { oweWake, wakeParentHandler } from './wake-parent.ts';

/* What tasks need of the chats of a host; a `ChatCore` has all of it. */
export type TaskChats = Pick<ChatCore, 'get' | 'observe' | 'hasStored' | 'create' | 'answer' | 'deliverNote'>;

export interface TaskRecord {
    projectId: string;
    parentId: string;
    childId: string;
    title: string;
    prompt: string;
}

/* What the verbs of a context CLI reach of the tasks. */
export interface TaskVerbs {
    /* `batchId` ties the tasks of one `team --task` call together, which wake the parent as one. */
    open(record: TaskRecord & { batchId?: string }): Promise<Task>;
    /* Opens a task for an agent that is already running, and owes the turn that carries it. */
    give(record: TaskRecord): Promise<Task>;
    /* Whether the host has a chat for this node at all, and whether a turn of it is in the way. */
    chatState(nodeId: string): Promise<'none' | 'idle' | 'running'>;
    /* Ends the open task of this child with the result it reported; null when it has none open. */
    done(childId: string, text: string): Promise<Task | null>;
    /* Every task the node gave or was given, oldest first. */
    involving(nodeId: string): Task[];
}

export interface TaskWords extends WaitingWords {
    /* What a running agent's CLI is sent with a task given to it; the prompt alone when absent. */
    assignment?: (task: Task) => string;
    /* Where the rest of a result that was cut is read, after the line in the wake that says so. */
    restOf?: (childId: string) => string;
}

export interface TaskWiringDeps {
    tasks: TaskStore;
    chats: TaskChats;
    outbox: TaskOutbox;
    /* Whether a project still places the node; a child that went is cancelled by `prune`, never failed. */
    placed(nodeId: string): boolean;
    /* What a person calls a node, for the notes a task leaves. */
    titleFor(nodeId: string): string | null;
    /* Raises attention on a node whose task failed, for the person who has to look at why. */
    alert(nodeId: string, title: string, body: string): void;
    /* Told of every task written, inside the broadcast of the child that settled it, so it only notes. */
    changed?: (task: Task) => void;
    /* When the host tries a turn that stopped on an overload again; null when it does not. */
    retryAt?: TaskCoordinatorDeps['retryAt'];
    words: TaskWords;
    now?: () => number;
}

export interface TaskWiring {
    coordinator: TaskCoordinator;
    waiting: WaitingObserver;
    verbs: TaskVerbs;
    requests: ChatRequests;
    handlers: OutboxHandlers<TaskWork>;
    /* For the worker's `onParked`: a task whose turn never opened is one nobody is working on, and fails. */
    onParked(entry: AnyOutboxEntry, error: unknown): void;
    /* For a project that no longer places these ids: cancel what went, then look at the parents again. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void>;
}

/*
 * The tasks of a host in one place, so the host only hands in what it has: the coordinator that
 * settles, the work the outbox runs, the notes in a parent's thread and what the verbs reach.
 */
export const wireTasks = (deps: TaskWiringDeps): TaskWiring => {
    const now = deps.now ?? Date.now;
    const { chats, outbox } = deps;
    const enqueue = (projectId: string, target: string, work: TaskWork, notBefore?: number): Promise<void> =>
        outbox.enqueue(projectId, target, work, notBefore);
    const limit = backgroundLimits(outbox);
    const coordinator = new TaskCoordinator({
        tasks: deps.tasks,
        now,
        chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
        placed: (nodeId) => deps.placed(nodeId),
        // Until the turn that carries a task ran, no turn of the child is its answer.
        owedTurn: (taskId) => outbox.list().some((entry) => isGiveTask(entry) && entry.payload.taskId === taskId),
        oweWake: (task) => oweWake({ enqueue }, task),
        alert: (nodeId, title, body) => deps.alert(nodeId, title, body),
        ...(deps.retryAt ? { retryAt: deps.retryAt } : {}),
        afterBackgroundWork: (chatId) => {
            const chat = chats.get(chatId);
            if (!chat?.running) {
                return 'gone';
            }
            return reportsOnBackgroundWork(chat.info.provider) ? 'reports' : 'silent';
        },
        commandsOf: (chatId) => chats.get(chatId)?.info.background ?? [],
        limit
    });

    deps.tasks.onChange((task: Task) => {
        deps.changed?.(task);
        // A cancelled task owes no wake of its own, but it may be the last of a team whose held results now go out.
        if (task.status === 'cancelled' && task.batchId !== undefined) {
            outbox.wake(task.parentId);
        }
        // However a task ended, the limit on its child's background commands has nothing left to settle.
        if (task.status !== 'open' && limit.owed(task.id)) {
            void limit.lapse(task.id).catch((e: unknown) => console.error(`Dropping the limit of task ${task.id} failed:`, errorText(e)));
        }
    });

    const requests = chatRequests(chats);
    const waiting = new WaitingObserver({ openTask: (childId) => deps.tasks.openFor(childId), enqueue, now });

    chats.observe((event) => {
        coordinator.chatEvent(event);
        waiting.chatEvent(event);
        if (event.event === 'chat.event' && chats.get(event.payload.chatId)?.info.activeTurnId === null) {
            outbox.wake(event.payload.chatId);
        }
    });

    const chatFor = chatOpener({ chats, placed: deps.placed });

    return {
        coordinator,
        waiting,
        verbs: {
            open: (record) => deps.tasks.open(record, now()),
            give: async (record) => {
                // The record first: the handler reads what the task asks from it, and a restart in between still owes the turn.
                const task = await deps.tasks.open(record, now());
                await enqueue(task.projectId, task.childId, { kind: 'give-task', payload: { taskId: task.id } });
                return task;
            },
            chatState: async (nodeId) => {
                const session = chats.get(nodeId);
                if (session) {
                    return session.info.activeTurnId === null ? 'idle' : 'running';
                }
                // A chat nobody has loaded is idle: the turn opens on the thread the host reads back from disk.
                return (await chats.hasStored(nodeId)) ? 'idle' : 'none';
            },
            done: (childId, text) => coordinator.done(childId, text),
            involving: (nodeId) => deps.tasks.involving(nodeId)
        },
        requests,
        handlers: {
            'wake-parent': wakeParentHandler({ tasks: deps.tasks, chat: chatFor, ...(deps.words.restOf ? { restOf: deps.words.restOf } : {}) }),
            'background-limit': backgroundLimitHandler({ tasks: deps.tasks, coordinator, chats, placed: deps.placed }),
            'give-task': giveTaskHandler({
                tasks: deps.tasks,
                chat: chatFor,
                titleFor: deps.titleFor,
                placed: deps.placed,
                ...(deps.words.assignment ? { assignment: deps.words.assignment } : {})
            }),
            'deliver-waiting': deliverWaitingHandler({
                request: requests.request,
                titleFor: deps.titleFor,
                deliver: (chatId, delivery) => chats.deliverNote(chatId, delivery),
                words: { app: deps.words.app, cli: deps.words.cli }
            })
        },
        onParked: (entry, error) => {
            if (isGiveTask(entry)) {
                coordinator.giveFailed(entry.target, error);
            }
        },
        prune: async (projectId, ids) => {
            coordinator.cancelled(await deps.tasks.prune(projectId, ids, now()));
        }
    };
};
