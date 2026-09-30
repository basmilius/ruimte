import type { ChatBackgroundTask, ChatItem, ChatTurnItem, Task, TaskResult } from '@ruimte/agent-contracts';
import { abortedByMachine } from '@ruimte/agent-contracts';
import { BACKGROUND_COMMAND_LIMIT_MS, commandLabel, isBackgroundWork, runningInBackground, runsInBackground } from '../chat/background-work.ts';
import { errorText } from '../error-text.ts';
import type { AgentEvent } from '../events.ts';
import type { TaskStore } from './task-store.ts';

export interface TaskCoordinatorDeps {
    tasks: TaskStore;
    now(): number;
    /* The thread of a chat, when this host has it loaded. */
    chatItems(chatId: string): readonly ChatItem[] | null;
    /* Whether a project still places the node; a child that went is cancelled by the prune, never failed. */
    placed(nodeId: string): boolean;
    loading?(chatId: string): boolean;
    /* Whether the host still owes the turn that carries a task, which is a task nobody is working on yet. */
    owedTurn(taskId: string): boolean;
    /* Owes the parent a wake; only ever writes the outbox. */
    oweWake(task: Task): Promise<void>;
    /* Raises attention on a node whose task failed, for the person who has to look at why. */
    alert(nodeId: string, title: string, body: string): void;
    /* When the host takes up a turn that stopped on an overload again; null when it does not, which makes it an error like any other. */
    retryAt?(chatId: string, turn: ChatTurnItem, items: readonly ChatItem[]): number | null;
    /*
     * What comes after the work a chat left running in the background ended: a turn its CLI opens about
     * it (`reports`), nothing (`silent`), or nothing ever again, since its process went (`gone`).
     */
    afterBackgroundWork(chatId: string): 'reports' | 'silent' | 'gone';
    /* The commands and monitors a chat's CLI runs in the background right now. */
    commandsOf(chatId: string): readonly ChatBackgroundTask[];
    /* The `background-limit` outbox entry of a task, which settles it once its commands ran too long. */
    limit: {
        owed(taskId: string): boolean;
        owe(task: Task, commands: readonly string[], at: number): Promise<void>;
        lapse(taskId: string): Promise<void>;
    };
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

const commandList = (commands: readonly string[]): string => commands.map((command) => `\`${command}\``).join(', ');

const outlastedNote = (commands: readonly string[]): string =>
    `The task settled after ${BACKGROUND_COMMAND_LIMIT_MS / 60_000} minutes while this still ran in the background: ${commandList(commands)}.`;

const restartedNote = (commands: readonly string[]): string => `The machine restarted while this still ran in the background: ${commandList(commands)}.`;

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
 * Settles tasks from what children do and does nothing else: it writes the task store and owes wakes
 * in the outbox, never starts a turn, since it runs inside the broadcast of the child it heard. A chat
 * child settles when a turn ends with none of its own tasks still open or waiting to wake it and no work
 * of its CLI's still running in the background, or once the commands it runs there outlast their limit;
 * an agent that is not a chat, which the host tells it about, settles only on `done`, or fails when it
 * ends without one.
 */
export class TaskCoordinator {
    private readonly deps: TaskCoordinatorDeps;
    private stopped = false;
    private readonly pending = new Set<Promise<unknown>>();

    constructor(deps: TaskCoordinatorDeps) {
        this.deps = deps;
    }

    /* The host is going down: what dies with it did not end its task. */
    stop(): void {
        this.stopped = true;
    }

    async settled(): Promise<void> {
        while (this.pending.size > 0) {
            await Promise.allSettled([...this.pending]);
        }
        await this.deps.tasks.settled();
    }

    /* For `chats.observe()`. */
    chatEvent(event: AgentEvent): void {
        if (this.stopped || event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chatEvent } = event.payload;
        if (this.deps.loading?.(chatId)) {
            return;
        }
        if (chatEvent.type === 'item' && chatEvent.item.kind === 'turn' && chatEvent.item.state === 'running') {
            this.turnStarted(chatId);
        } else if (chatEvent.type === 'item' && chatEvent.item.kind === 'turn') {
            this.turnEnded(chatId, chatEvent.item);
        } else if (chatEvent.type === 'item' && isBackgroundWork(chatEvent.item) && !runsInBackground(chatEvent.item)) {
            this.recheck(chatId);
        } else if (chatEvent.type === 'info' && chatEvent.info.activeTurnId === null) {
            // A child that waited on tasks of its own may be done now that its last wake turn went.
            this.recheck(chatId);
        }
    }

    /*
     * An agent that is not a chat ended, so no turn of it will answer its task: it fails with `text`,
     * which says how that kind of agent reports back.
     */
    agentEnded(childId: string, text: string): void {
        if (this.stopped) {
            return;
        }
        const task = this.deps.tasks.openFor(childId);
        if (!task || !this.deps.placed(childId)) {
            return;
        }
        this.settle(task, 'failed', { text, source: 'exit', at: this.deps.now() });
    }

    startFailed(childId: string, error: unknown): void {
        this.failed(childId, `The agent could not be started: ${errorText(error)}`);
    }

    /* The turn a task given to a running agent was to open never opened, so nobody is working on it. */
    giveFailed(childId: string, error: unknown): void {
        this.failed(childId, `The task could not be given: ${errorText(error)}`);
    }

    /* `done` from the child itself, which wins over whatever else was about to settle it. */
    async done(childId: string, text: string): Promise<Task | null> {
        const task = this.deps.tasks.openFor(childId);
        if (!task) {
            return null;
        }
        return this.settleNow(task, 'done', { text, source: 'done', at: this.deps.now() });
    }

    /*
     * The limit on the commands a child ran in the background passed, or a restart took them down with
     * its CLI: its task settles on its last turn, saying what still ran, and fails after a restart as it
     * does when the CLI goes within one run.
     */
    async outlasted(childId: string, commands: readonly string[], cause: 'limit' | 'restart' = 'limit'): Promise<Task | null> {
        const task = this.deps.tasks.openFor(childId);
        const items = this.deps.chatItems(childId);
        if (this.stopped || !task || items === null || this.delegating(childId)) {
            return null;
        }
        const last = items.findLast((item): item is ChatTurnItem => item.kind === 'turn');
        if (!last || last.state === 'running' || !this.answers(items, last, task)) {
            return null;
        }
        const { status, result } = resultOfTurn(last, items, this.deps.now());
        if (cause === 'restart') {
            return this.settleNow(task, 'failed', { ...result, text: `${result.text}\n\n${restartedNote(commands)}`, source: 'exit' });
        }
        return this.settleNow(task, status, { ...result, text: `${result.text}\n\n${outlastedNote(commands)}` });
    }

    /* Tasks of children a person removed; their parent may have been waiting on nothing else. */
    cancelled(tasks: readonly Task[]): void {
        for (const task of tasks) {
            this.recheck(task.parentId);
        }
    }

    /* An open task of this child that nothing can carry any more. */
    private failed(childId: string, text: string): void {
        const task = this.deps.tasks.openFor(childId);
        if (!task || this.stopped) {
            return;
        }
        this.settle(task, 'failed', { text, source: 'exit', at: this.deps.now() });
    }

    /*
     * Whether this turn is the one the task's result comes from. A task given to an already-working agent
     * gets a turn of its own that names it; the turn that was in its way answers the person who sent it,
     * not the task, and nothing settles while that turn is still owed. A turn after it answers too, as the
     * one the CLI opens about work that turn left running. A child opened with its task has no turn of that
     * kind, so its first turn settles it, as it always did.
     */
    private answers(items: readonly ChatItem[], turn: ChatTurnItem, task: Task): boolean {
        if ((turn.taskIds ?? []).includes(task.id)) {
            return true;
        }
        if (this.deps.owedTurn(task.id)) {
            return false;
        }
        const own = items.findIndex((item) => item.kind === 'turn' && (item.taskIds ?? []).includes(task.id));
        return own === -1 ? task.requiresTaskTurn !== true && turn.createdAt >= task.createdAt : own < items.findIndex((item) => item.id === turn.id);
    }

    private turnEnded(chatId: string, turn: ChatTurnItem): void {
        const task = this.deps.tasks.openFor(chatId);
        const items = this.deps.chatItems(chatId);
        if (!task || items === null || !this.answers(items, turn, task) || this.delegating(chatId)) {
            return;
        }
        const paused = this.pauseFor(chatId, turn, items);
        if (paused !== null) {
            this.hold(task, paused);
            return;
        }
        // A turn a person stopped or that failed ends the task as it always did, whatever still runs beside it.
        if (turn.state === 'done' && this.heldInBackground(chatId, task, items)) {
            this.track(
                this.deps.tasks.holdBackground(task.id, {
                    turnId: turn.id,
                    itemIds: runningInBackground(items).map((item) => item.id),
                    commands: this.deps.commandsOf(chatId).map(commandLabel)
                }),
                `Saving the background work of task ${task.id} failed`
            );
            return;
        }
        if (task.background?.turnId === turn.id) {
            const after = this.deps.afterBackgroundWork(chatId);
            if (after === 'reports') {
                return;
            }
            if (after === 'gone') {
                if (task.background.itemIds.length === 0 && this.deps.limit.owed(task.id)) {
                    return;
                }
                const lost = task.background.itemIds.filter((id) => {
                    const item = items.find((item) => item.id === id);
                    return !item || (item.kind === 'subagent' ? item.status !== 'done' : item.kind !== 'tool' || item.state !== 'done');
                });
                if (lost.length > 0 || task.background.commands.length > 0) {
                    this.settle(task, 'failed', {
                        text: `The agent ended before its background work completed: ${[
                            ...lost.map((id) => {
                                const row = items.find((item) => item.id === id);
                                return row?.kind === 'subagent' ? row.description || row.toolUseId : row?.kind === 'tool' ? row.name : id;
                            }),
                            ...task.background.commands
                        ].join(', ')}. This work will not send a result.`,
                        source: 'exit',
                        at: this.deps.now()
                    });
                } else {
                    const reports = task.background.itemIds.flatMap((id) => {
                        const row = items.find((item) => item.id === id);
                        const report = row?.kind === 'subagent' ? row.result : row?.kind === 'tool' ? row.output : null;
                        return report ? [report] : [];
                    });
                    this.settle(task, 'done', {
                        text: reports.join('\n\n') || resultOfTurn(turn, items, this.deps.now()).result.text,
                        source: 'turn',
                        at: this.deps.now()
                    });
                }
                return;
            }
        } else if (turn.state === 'done' && this.deps.limit.owed(task.id) && this.deps.afterBackgroundWork(chatId) === 'gone') {
            // After a restart nothing here remembers the turn was held, but the limit it owes does, and that settles it.
            return;
        }
        const { status, result } = resultOfTurn(turn, items, this.deps.now());
        this.settle(task, status, result);
    }

    /*
     * Whether work in the background keeps this task open past the turn. Commands and monitors alone hold
     * it only until the limit, owed from the moment they are all that is left; a subagent or a workflow
     * running beside them holds it with no limit at all.
     */
    private heldInBackground(chatId: string, task: Task, items: readonly ChatItem[]): boolean {
        if (runningInBackground(items).length > 0) {
            if (this.deps.limit.owed(task.id)) {
                void this.deps.limit.lapse(task.id).catch((e: unknown) => console.error(`Dropping the limit of task ${task.id} failed:`, errorText(e)));
            }
            return true;
        }
        const commands = this.deps.commandsOf(chatId);
        if (commands.length === 0) {
            return false;
        }
        if (!this.deps.limit.owed(task.id)) {
            void this.deps.limit
                .owe(task, commands.map(commandLabel), this.deps.now() + BACKGROUND_COMMAND_LIMIT_MS)
                .catch((e: unknown) => console.error(`Owing the limit of task ${task.id} failed:`, errorText(e)));
        }
        return true;
    }

    /*
     * A limit is work waiting, not work that failed: the plan's limit always holds the task until the child
     * finishes after it, an overload only while the host still owes the turn another try.
     */
    private pauseFor(chatId: string, turn: ChatTurnItem, items: readonly ChatItem[]): NonNullable<Task['paused']> | null {
        const limit = turn.state === 'error' ? turn.limit : undefined;
        if (limit?.kind === 'usage') {
            return { kind: 'usage', ...(limit.resetsAt === undefined ? {} : { until: limit.resetsAt }) };
        }
        if (limit?.kind === 'overload') {
            const at = this.deps.retryAt?.(chatId, turn, items) ?? null;
            return at === null ? null : { kind: 'overload', until: at };
        }
        return null;
    }

    /* A child that took up work again is no longer waiting out a limit. */
    private turnStarted(chatId: string): void {
        const task = this.deps.tasks.openFor(chatId);
        if (task?.paused !== undefined) {
            this.hold(task, null);
        }
    }

    private hold(task: Task, paused: NonNullable<Task['paused']> | null): void {
        void this.deps.tasks.pause(task.id, paused).catch((e: unknown) => console.error(`Pausing task ${task.id} failed:`, errorText(e)));
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
        this.track(this.settleNow(task, status, result), `Settling task ${task.id} failed`);
    }

    private track(work: Promise<unknown>, message: string): void {
        this.pending.add(work);
        void work.catch((e: unknown) => console.error(`${message}:`, errorText(e))).finally(() => this.pending.delete(work));
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
