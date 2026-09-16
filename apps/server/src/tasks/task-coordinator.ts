import type { ChatItem, ChatTurnItem, Task, TaskResult } from '@ruimte/contracts';
import { abortedByMachine } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import type { TaskStore } from './task-store.ts';

export interface TaskCoordinatorDeps {
    tasks: TaskStore;
    now(): number;
    /* The thread of a chat, when this daemon has it loaded. */
    chatItems(chatId: string): readonly ChatItem[] | null;
    /* Whether a project still places the node; a child that went is cancelled by the prune, never failed. */
    placed(nodeId: string): boolean;
    /* Owes the parent a wake; only ever writes the outbox. */
    oweWake(task: Task): Promise<void>;
    /* Raises attention on a node whose task failed, for the person who has to look at why. */
    alert(nodeId: string, title: string, body: string): void;
}

// A child's answer is its last word of the turn; the thinking and the tools before it are not the result.
const answerOf = (items: readonly ChatItem[], turnId: string): string | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'assistant' && item.turnId === turnId && !item.parentToolUseId && item.text.trim() !== '') {
            return item.text.trim();
        }
    }
    return null;
};

const lastNote = (items: readonly ChatItem[], turnId: string, levels: readonly string[]): string | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'note' && item.turnId === turnId && levels.includes(item.level)) {
            return item.text;
        }
    }
    return null;
};

/* What a settled turn of a child makes of its task. */
export const resultOfTurn = (turn: ChatTurnItem, items: readonly ChatItem[], at: number): { status: 'done' | 'failed'; result: TaskResult } => {
    if (turn.state === 'done') {
        return { status: 'done', result: { text: answerOf(items, turn.id) ?? 'It ended its turn without an answer.', source: 'turn', at } };
    }
    if (turn.state === 'aborted') {
        const text = abortedByMachine(turn, items)
            ? (lastNote(items, turn.id, ['warning']) ?? 'The machine stopped it.')
            : 'It was stopped before it finished.';
        return { status: 'failed', result: { text, source: 'turn', at } };
    }
    return { status: 'failed', result: { text: lastNote(items, turn.id, ['error']) ?? 'Its turn ended in an error.', source: 'turn', at } };
};

/*
 * Settles tasks from what the children do, and does nothing else: it writes the task store and owes
 * wakes in the outbox, but never starts a turn, since it runs inside the broadcast of the child it
 * heard. A chat child settles when a turn of its ends with no task of its own still open or waiting
 * to wake it, which is its first turn unless it delegated in turn; a terminal child only with `done`,
 * or by failing when it leaves without one.
 */
export class TaskCoordinator {
    private readonly deps: TaskCoordinatorDeps;
    private stopped = false;

    constructor(deps: TaskCoordinatorDeps) {
        this.deps = deps;
    }

    /* The daemon is going down: what dies with it did not end its task. */
    stop(): void {
        this.stopped = true;
    }

    /* For `chats.observe()`. */
    chatEvent(event: SessionEvent): void {
        if (this.stopped || event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chatEvent } = event.payload;
        if (chatEvent.type === 'item' && chatEvent.item.kind === 'turn' && chatEvent.item.state !== 'running') {
            this.turnEnded(chatId, chatEvent.item);
        } else if (chatEvent.type === 'info' && chatEvent.info.activeTurnId === null) {
            // A child that waited on tasks of its own may be done now that its last wake turn went.
            this.recheck(chatId);
        }
    }

    /* For `sessions.observe()`: a terminal agent that said goodbye. */
    sessionEvent(event: SessionEvent): void {
        if (this.stopped || event.event !== 'session.status' || event.payload.agent?.status !== 'exited') {
            return;
        }
        this.terminalEnded(event.payload.sessionId);
    }

    /* A terminal whose shell went, with or without its agent saying so first. */
    terminalEnded(sessionId: string): void {
        if (this.stopped) {
            return;
        }
        const task = this.deps.tasks.openFor(sessionId);
        if (!task || !this.deps.placed(sessionId)) {
            return;
        }
        this.settle(task, 'failed', {
            text: 'It ended without a result: a terminal reports back with ruimte-context done.',
            source: 'exit',
            at: this.deps.now()
        });
    }

    /* The agent of a child could not be started at all. */
    startFailed(childId: string, error: unknown): void {
        const task = this.deps.tasks.openFor(childId);
        if (!task || this.stopped) {
            return;
        }
        this.settle(task, 'failed', { text: `The agent could not be started: ${errorText(error)}`, source: 'exit', at: this.deps.now() });
    }

    /* `ruimte-context done` from the child itself, which wins over whatever else was about to settle it. */
    async done(childId: string, text: string): Promise<Task | null> {
        const task = this.deps.tasks.openFor(childId);
        if (!task) {
            return null;
        }
        return this.settleNow(task, 'done', { text, source: 'done', at: this.deps.now() });
    }

    /* Tasks of children a person removed; their parent may have been waiting on nothing else. */
    cancelled(tasks: readonly Task[]): void {
        for (const task of tasks) {
            this.recheck(task.parentId);
        }
    }

    private turnEnded(chatId: string, turn: ChatTurnItem): void {
        const task = this.deps.tasks.openFor(chatId);
        const items = this.deps.chatItems(chatId);
        if (!task || items === null || this.delegating(chatId)) {
            return;
        }
        const { status, result } = resultOfTurn(turn, items, this.deps.now());
        this.settle(task, status, result);
    }

    private recheck(chatId: string): void {
        const task = this.deps.tasks.openFor(chatId);
        const items = this.deps.chatItems(chatId);
        if (!task || items === null || this.delegating(chatId)) {
            return;
        }
        const last = [...items].reverse().find((item): item is ChatTurnItem => item.kind === 'turn');
        if (last && last.state !== 'running' && last.createdAt >= task.createdAt) {
            this.turnEnded(chatId, last);
        }
    }

    /* A child that gave tasks of its own is not finished while one is open or has yet to wake it. */
    private delegating(chatId: string): boolean {
        return this.deps.tasks.ofParent(chatId).some((task) => task.status === 'open' || task.wake === 'pending');
    }

    private settle(task: Task, status: 'done' | 'failed', result: TaskResult): void {
        void this.settleNow(task, status, result).catch((e: unknown) => console.error(`Settling task ${task.id} failed:`, errorText(e)));
    }

    private async settleNow(task: Task, status: 'done' | 'failed', result: TaskResult): Promise<Task | null> {
        const settled = await this.deps.tasks.settle(task.id, status, result, this.deps.now());
        if (!settled) {
            return null;
        }
        await this.deps.oweWake(settled);
        if (status === 'failed') {
            this.deps.alert(settled.childId, `Task failed: ${settled.title}`, result.text.slice(0, 500));
        }
        return settled;
    }
}
