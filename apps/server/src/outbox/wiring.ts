import type { Task } from '@ruimte/contracts';
import type { AgentLineageStore } from '../agents/lineage.ts';
import type { PendingPromptStore } from '../agents/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { limitResumeAt } from '@ruimte/agents/chat/limit-resume';
import { wireSummaries, type SummaryWiring } from '../chat/summary.ts';
import { chatOpener } from '../chat/wake-chat.ts';
import { deliverMessageHandler } from '../context/deliver-message.ts';
import type { NoticeStore } from '../context/notices.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { TaskStore } from '../tasks/task-store.ts';
import { wireTasks, type TaskWiring } from '../tasks/wiring.ts';
import { errorText } from '../error-text.ts';
import { wireEndChildren, type EndChildrenWiring } from './end-children.ts';
import type { OutboxStore, OutboxWork } from './outbox.ts';
import { OutboxWorker, type OutboxClock } from './outbox-worker.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from './resume-run.ts';
import { startAgentHandler } from './start-agent.ts';

export interface OutboxLinkOptions {
    outbox: OutboxStore;
    /* The project a chat lives in, read when a run is owed a resume and not before. */
    projectOf(chatId: string): string | null;
    /* Run after every entry is on disk, for a test that waits on the outbox. */
    onEnqueued?: (work: OutboxWork) => void;
}

/*
 * The chat manager and the worker each need the other. A run a restart interrupted is owed a resume
 * before the worker that would run it exists. Both sides hold this instead, and `wireOutbox` fills
 * it in once the worker is built.
 */
export class OutboxLink {
    /* What the chat manager reports an interrupted run to. */
    readonly onInterruptedRun: ReturnType<typeof oweResume>;
    private readonly onEnqueued: ((work: OutboxWork) => void) | null;
    private readonly outbox: OutboxStore;
    private readonly projectOf: (chatId: string) => string | null;
    private worker: OutboxWorker | null = null;

    constructor(options: OutboxLinkOptions) {
        this.onEnqueued = options.onEnqueued ?? null;
        this.outbox = options.outbox;
        this.projectOf = options.projectOf;
        this.onInterruptedRun = oweResume({
            projectOf: options.projectOf,
            entries: () => options.outbox.list(),
            enqueue: (projectId, target, work) => this.enqueue(projectId, target, work)
        });
    }

    bind(worker: OutboxWorker): void {
        this.worker = worker;
    }

    async enqueue(projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void> {
        await this.require().enqueue(projectId, target, work, notBefore);
        this.onEnqueued?.(work);
    }

    wake(chatId: string): void {
        this.require().wake(chatId);
    }

    /* Owes the resume of a limited turn at `at`, in place of whatever this chat owed before; a chat no project holds is owed nothing. */
    async oweLimitResume(chatId: string, turnId: string, at: number): Promise<void> {
        const projectId = this.projectOf(chatId);
        if (projectId === null) {
            return;
        }
        await this.lapseLimitResume(chatId);
        await this.require().enqueue(projectId, chatId, { kind: 'resume-limit', payload: { turnId } }, at);
        this.onEnqueued?.({ kind: 'resume-limit', payload: { turnId } });
    }

    owesLimitResume(chatId: string): boolean {
        return this.outbox.list().some((entry) => entry.kind === 'resume-limit' && entry.target === chatId);
    }

    /* Drops what a chat was owed after a limit; with no chat, what every chat was, as the machine's switch goes off. */
    async lapseLimitResume(chatId?: string): Promise<void> {
        for (const entry of this.outbox.list()) {
            if (entry.kind === 'resume-limit' && (chatId === undefined || entry.target === chatId)) {
                await this.outbox.remove(entry.id);
            }
        }
    }

    /* Owes the settle of a task at `at`, for when the commands its child runs in the background are still all that holds it. */
    async oweBackgroundLimit(task: Task, commands: readonly string[], at: number): Promise<void> {
        const work: OutboxWork = { kind: 'background-limit', payload: { taskId: task.id, commands: [...commands] } };
        await this.require().enqueue(task.projectId, task.childId, work, at);
        this.onEnqueued?.(work);
    }

    owesBackgroundLimit(taskId: string): boolean {
        return this.outbox.list().some((entry) => entry.kind === 'background-limit' && entry.payload.taskId === taskId);
    }

    async lapseBackgroundLimit(taskId: string): Promise<void> {
        for (const entry of this.outbox.list()) {
            if (entry.kind === 'background-limit' && entry.payload.taskId === taskId) {
                await this.outbox.remove(entry.id);
            }
        }
    }

    private require(): OutboxWorker {
        if (this.worker === null) {
            throw new Error('The outbox is used before it is wired');
        }
        return this.worker;
    }
}

export interface OutboxWiringDeps {
    link: OutboxLink;
    outbox: OutboxStore;
    projects: ProjectStore;
    lineage: AgentLineageStore;
    prompts: PendingPromptStore;
    notices: NoticeStore;
    tasks: TaskStore;
    chats: ChatManager;
    sessions: SessionManager;
    /* Raises attention on a node; the daemon pushes, a test only writes down that it happened. */
    alert(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
    clock?: OutboxClock;
    now?: () => number;
    log?: (line: string) => void;
    /* Refuses a directory an agent node may not start in, the same check the managers make. */
    checkCwd?: (nodeId: string, cwd: string) => Promise<void>;
    /* The machine's switch for taking a limited chat up again on a clock; off without it. */
    resumeAtReset?: () => boolean;
    /* Every unused fork a deleted node took along, for a caller that waits on them. */
    onDropped?: (drop: Promise<void>) => void;
    /* What a prune that failed does; the daemon logs it, a test stays quiet. */
    onFailed?: (what: string, error: unknown) => void;
}

export interface OutboxWiring {
    worker: OutboxWorker;
    tasks: TaskWiring;
    endChildren: EndChildrenWiring;
    summaries: SummaryWiring;
    /* For `ProjectIndex.onPlaces`. Everything a node that left the document takes along. */
    places(projectId: string, ids: ReadonlySet<string>): void;
}

/*
 * Everything the outbox drives, wired once for the daemon and the test daemon both. A handler that
 * only one of them knew would fail in production or in the tests, never in both.
 */
export const wireOutbox = (deps: OutboxWiringDeps): OutboxWiring => {
    const { link, outbox, projects, lineage, prompts, notices, tasks, chats, sessions } = deps;
    const enqueue = (projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void> =>
        link.enqueue(projectId, target, work, notBefore);
    const placed = (nodeId: string): boolean => projects.index.locate(nodeId) !== null;
    const now = deps.now ?? Date.now;
    const failed = (what: string, error: unknown): void => {
        if (deps.onFailed) {
            deps.onFailed(what, error);
            return;
        }
        console.error(`${what}:`, errorText(error));
    };

    const taskWiring = wireTasks({
        tasks,
        chats,
        placed,
        owedTurn: (taskId) => outbox.list().some((entry) => entry.kind === 'give-task' && entry.payload.taskId === taskId),
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        enqueue,
        alert: (target, nodeId, title, body) => deps.alert(target, nodeId, title, body),
        wake: (chatId) => link.wake(chatId),
        backgroundLimit: {
            owed: (taskId) => link.owesBackgroundLimit(taskId),
            owe: (task, commands, at) => link.oweBackgroundLimit(task, commands, at),
            lapse: (taskId) => link.lapseBackgroundLimit(taskId)
        },
        // The same answer the chat itself gives as its turn ends, so a task pauses exactly while a retry is owed.
        retryAt: (chatId, turn, items) =>
            deps.resumeAtReset?.() === true && chats.get(chatId)?.info.resumeAtReset !== false ? limitResumeAt(items, turn, now()) : null,
        ...(deps.now ? { now: deps.now } : {})
    });

    // Stopping or deleting a node ends the agents it opened, through the outbox so a restart in between still does.
    const endChildren = wireEndChildren({
        lineage,
        outbox,
        tasks,
        chats,
        sessions,
        enqueue,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.log ? { log: deps.log } : {})
    });

    const summaries = wireSummaries({
        chats,
        host: { locate: (id) => projects.index.locate(id), mutate: (projectId, apply) => projects.mutate(projectId, apply) },
        titleFor: (id) => projects.index.titleFor(id),
        enqueue
    });

    const worker = new OutboxWorker({
        store: outbox,
        ...(deps.clock ? { clock: deps.clock } : {}),
        handlers: {
            'start-agent': startAgentHandler({
                placed,
                hasChat: (chatId) => chats.get(chatId) !== undefined,
                createChat: (payload) => chats.create(payload),
                composerPreference: (provider) => chats.composerPreferences.for(provider),
                killChat: (chatId) => chats.kill(chatId),
                hasSession: (sessionId) => sessions.get(sessionId) !== undefined,
                createSession: (options) => sessions.create(options),
                killSession: (sessionId) => sessions.kill(sessionId),
                onGaveUp: taskWiring.onStartGaveUp,
                ...(deps.checkCwd ? { checkCwd: deps.checkCwd } : {}),
                ...(deps.log ? { log: deps.log } : {})
            }),
            'resume-run': resumeRunHandler(chats),
            // A node that left the document takes its entry along through the prune; one that is still owed runs here.
            'resume-limit': (entry) => (placed(entry.target) ? chats.takeUpAfterLimit(entry.target, entry.payload.turnId) : Promise.resolve()),
            'background-limit': taskWiring.backgroundLimit,
            'wake-parent': taskWiring.wakeParent,
            'give-task': taskWiring.giveTask,
            'deliver-message': deliverMessageHandler({
                notices,
                chat: chatOpener({ chats, placed }),
                placed
            }),
            'end-children': endChildren.handler,
            'deliver-summary': summaries.handler,
            'deliver-waiting': taskWiring.deliverWaiting
        },
        onParked: (entry, error) => {
            resumeRunParked(chats)(entry, error);
            taskWiring.onParked(entry, error);
            summaries.onParked(entry, error);
        }
    });
    link.bind(worker);

    return {
        worker,
        tasks: taskWiring,
        endChildren,
        summaries,
        // A node deleted before anyone ran it takes its prompt with it, and a node that is gone frees the count its opener is held to.
        places: (projectId, ids) => {
            endChildren.places(projectId, ids);
            void prompts.prune(projectId, ids).catch((e) => failed('Pruning pending prompts failed', e));
            for (const forkId of lineage.forksLeaving(projectId, ids)) {
                const drop = chats.dropUnspokenFork(forkId);
                if (deps.onDropped) {
                    deps.onDropped(drop);
                } else {
                    void drop.catch((e) => failed('Removing an unused fork failed', e));
                }
            }
            void lineage.prune(projectId, ids).catch((e) => failed('Pruning agent lineage failed', e));
            void notices.prune(projectId, ids).catch((e) => failed('Pruning waiting messages failed', e));
            void outbox.prune(projectId, ids).catch((e) => failed('Pruning the outbox failed', e));
            void taskWiring.prune(projectId, ids).catch((e) => failed('Pruning tasks failed', e));
        }
    };
};
