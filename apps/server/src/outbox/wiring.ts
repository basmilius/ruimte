import type { AgentLineageStore } from '../agents/lineage.ts';
import type { PendingPromptStore } from '../agents/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
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
    private worker: OutboxWorker | null = null;

    constructor(options: OutboxLinkOptions) {
        this.onEnqueued = options.onEnqueued ?? null;
        this.onInterruptedRun = oweResume({
            projectOf: options.projectOf,
            entries: () => options.outbox.list(),
            enqueue: (projectId, target, work) => this.enqueue(projectId, target, work)
        });
    }

    bind(worker: OutboxWorker): void {
        this.worker = worker;
    }

    async enqueue(projectId: string, target: string, work: OutboxWork): Promise<void> {
        await this.require().enqueue(projectId, target, work);
        this.onEnqueued?.(work);
    }

    wake(chatId: string): void {
        this.require().wake(chatId);
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
    const enqueue = (projectId: string, target: string, work: OutboxWork): Promise<void> => link.enqueue(projectId, target, work);
    const placed = (nodeId: string): boolean => projects.index.locate(nodeId) !== null;
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
                ...(deps.log ? { log: deps.log } : {})
            }),
            'resume-run': resumeRunHandler(chats),
            'wake-parent': taskWiring.wakeParent,
            'give-task': taskWiring.giveTask,
            'deliver-message': deliverMessageHandler({
                notices,
                chat: chatOpener({ chats, placed }),
                placed
            }),
            'end-children': endChildren.handler,
            'deliver-summary': summaries.handler
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
