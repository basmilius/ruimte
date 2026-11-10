import type { TaskCoordinator, TaskCoordinatorDeps, TaskStore, WaitingObserver, OutboxHandlers } from '@adecore/agents/coordination';
import { wireTasks as wireTaskCore, type TaskVerbs } from '@adecore/agents/coordination';
import type { Task } from '@ruimte/contracts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { OutboxEntry, OutboxWork } from '../outbox/outbox.ts';
import { parkedNote } from './parked-note.ts';
import { terminalTasks, type TerminalTasks } from './terminal-tasks.ts';
import { TASK_WORDS } from './words.ts';

interface TaskWiringDeps {
    tasks: TaskStore;
    chats: ChatManager;
    placed(nodeId: string): boolean;
    /* Every entry the outbox owes, which is where a task's turn, wake and limit are owed. */
    entries(): readonly OutboxEntry[];
    remove(id: string): Promise<void>;
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
    now?: () => number;
}

export interface TaskWiring {
    coordinator: TaskCoordinator;
    recover(): Promise<void>;
    waiting: WaitingObserver;
    terminals: TerminalTasks;
    host: TaskVerbs;
    wakeParent: OutboxHandlers<OutboxWork>['wake-parent'];
    backgroundLimit: OutboxHandlers<OutboxWork>['background-limit'];
    giveTask: OutboxHandlers<OutboxWork>['give-task'];
    deliverWaiting: OutboxHandlers<OutboxWork>['deliver-waiting'];
    /* Given up on: what waited on the entry hears it, and the chat is told in the words of the kind. */
    onParked(entry: OutboxEntry, error: unknown): void;
    /* What the daemon does with the child's own prune of the project: cancel, then look at the parents again. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void>;
}

/*
 * Ruimte's binding of the tasks in @adecore/agents: its terminals beside the chats, the rows a task draws
 * in its parent, the words of its tools, and a note about work the outbox gave up on.
 */
export function wireTasks(deps: TaskWiringDeps): TaskWiring {
    const core = wireTaskCore({
        tasks: deps.tasks,
        chats: deps.chats.core,
        outbox: { list: deps.entries, enqueue: deps.enqueue, remove: deps.remove, wake: deps.wake },
        placed: deps.placed,
        titleFor: deps.titleFor,
        alert: (nodeId, title, body) => deps.alert(deps.chats.core.get(nodeId) ? 'chat' : 'terminal', nodeId, title, body),
        // Deferred, so a row is never written into a parent from inside the broadcast of the child that settled it.
        changed: (task: Task) => queueMicrotask(() => deps.chats.core.syncTaskRow(task)),
        ...(deps.retryAt ? { retryAt: deps.retryAt } : {}),
        words: TASK_WORDS,
        ...(deps.now ? { now: deps.now } : {})
    });

    const onParked = parkedNote({
        madeBy: deps.madeBy,
        titleFor: deps.titleFor,
        note: (chatId, text) => deps.chats.core.addNote(chatId, 'warning', text),
        alert: (chatId, text) => deps.alert('chat', chatId, 'Could not wake the chat', text)
    });

    return {
        coordinator: core.coordinator,
        recover: core.recover,
        waiting: core.waiting,
        terminals: terminalTasks(core.coordinator),
        host: core.verbs,
        wakeParent: core.handlers['wake-parent'],
        backgroundLimit: core.handlers['background-limit'],
        giveTask: core.handlers['give-task'],
        deliverWaiting: core.handlers['deliver-waiting'],
        onParked: (entry, error) => {
            core.onParked(entry, error);
            if (entry.kind === 'start-agent') {
                core.coordinator.startFailed(entry.target, error);
            }
            onParked(entry, error);
        },
        prune: core.prune
    };
}
