import { chatOpener, limitResumeAt } from '@adecore/agents/chat';
import {
    deliverMessageHandler,
    OutboxWorker,
    oweResume,
    resumeRunHandler,
    resumeRunParked,
    type AgentLineageStore,
    type NoticeStore,
    type Clock,
    type TaskStore
} from '@adecore/agents/coordination';
import type { Task } from '@ruimte/contracts';
import type { PendingPromptStore } from '../canvas/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { MESSAGE_WORDS } from '../context/notices.ts';
import { errorText } from '../error-text.ts';
import type { NodeLifecycle } from '../node-lifecycle.ts';
import { wireEndChildren, type EndChildrenWiring } from '../outbox/end-children.ts';
import { OUTBOX_KIND_NAMES, outboxRetries } from '../outbox/kinds/index.ts';
import type { OutboxStore, OutboxWork } from '../outbox/outbox.ts';
import { startAgentHandler } from '../outbox/start-agent.ts';
import { wireSummaries, type SummaryWiring } from '../outbox/summary.ts';
import { placesOf } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { wireTasks, type TaskWiring } from '../tasks/wiring.ts';

interface OutboxLinkOptions {
    outbox: OutboxStore;
    /* The project a chat lives in, read when a run is owed a resume and not before. */
    projectOf(chatId: string): string | null;
    clock?: Clock;
    /* Run after every entry is on disk, for a test that waits on the outbox. */
    onEnqueued?: (work: OutboxWork) => void;
}

/*
 * The worker and what the chat manager needs of it before the daemon is wired: a run a restart
 * interrupted is owed a resume as the manager starts. The worker has no handlers yet; each feature
 * adds its own where it is wired (`worker.handle`), and the worker refuses to start without all.
 */
export class OutboxLink {
    readonly worker: OutboxWorker<OutboxWork>;
    /* What the chat manager reports an interrupted run to. */
    readonly onInterruptedRun: ReturnType<typeof oweResume>;
    private readonly onEnqueued: ((work: OutboxWork) => void) | null;
    private readonly outbox: OutboxStore;
    private readonly projectOf: (chatId: string) => string | null;

    constructor(options: OutboxLinkOptions) {
        this.worker = new OutboxWorker({
            store: options.outbox,
            kinds: OUTBOX_KIND_NAMES,
            retries: outboxRetries(),
            ...(options.clock ? { clock: options.clock } : {})
        });
        this.onEnqueued = options.onEnqueued ?? null;
        this.outbox = options.outbox;
        this.projectOf = options.projectOf;
        this.onInterruptedRun = oweResume({
            projectOf: options.projectOf,
            entries: () => options.outbox.list(),
            enqueue: (projectId, target, work) => this.enqueue(projectId, target, work)
        });
    }

    async enqueue(projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void> {
        await this.worker.enqueue(projectId, target, work, notBefore);
        this.onEnqueued?.(work);
    }

    wake(chatId: string): void {
        this.worker.wake(chatId);
    }

    /* Owes the resume of a limited turn at `at`, in place of whatever this chat owed before; a chat no project holds is owed nothing. */
    async oweLimitResume(chatId: string, turnId: string, at: number): Promise<void> {
        const projectId = this.projectOf(chatId);
        if (projectId === null) {
            return;
        }
        await this.lapseLimitResume(chatId);
        await this.enqueue(projectId, chatId, { kind: 'resume-limit', payload: { turnId } }, at);
    }

    owesLimitResume(chatId: string): boolean {
        return this.outbox.owes('resume-limit', chatId);
    }

    /* Drops what a chat was owed after a limit; with no chat, what every chat was, as the machine's switch goes off. */
    async lapseLimitResume(chatId?: string): Promise<void> {
        for (const entry of this.outbox.ofKind('resume-limit')) {
            if (chatId === undefined || entry.target === chatId) {
                await this.outbox.remove(entry.id);
            }
        }
    }
}

interface OutboxWiringDeps {
    link: OutboxLink;
    outbox: OutboxStore;
    projects: ProjectStore;
    lineage: AgentLineageStore;
    prompts: PendingPromptStore;
    notices: NoticeStore;
    tasks: TaskStore;
    chats: ChatManager;
    sessions: SessionManager;
    lifecycle: NodeLifecycle;
    /* Raises attention on a node; the daemon pushes, a test only writes down that it happened. */
    alert(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
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
    /*
     * Whether another machine gave this task (`peer/worker/peer-tasks.ts`). Its parent is no chat here, so
     * nothing wakes it, and its result is owed to that machine.
     */
    isPeerTask(task: Task): boolean;
    /* The ids of a project that stand in for the parents of such tasks, which the project's prune keeps. */
    peerParents(projectId: string): ReadonlySet<string>;
    /* Ends what runs on another machine for a node, which nothing here shows (`peer/giver/remote-tasks.ts`). */
    remoteStop(nodeId: string): Promise<void>;
}

interface OutboxWiring {
    worker: OutboxWorker<OutboxWork>;
    tasks: TaskWiring;
    endChildren: EndChildrenWiring;
    summaries: SummaryWiring;
}

/*
 * What the outbox drives for the chats and tasks, wired once for the daemon and the test daemon both.
 * The kinds of work the other features owe are handled where those are wired.
 */
export function wireOutbox(deps: OutboxWiringDeps): OutboxWiring {
    const { link, outbox, projects, lineage, prompts, notices, tasks, chats, sessions, lifecycle } = deps;
    const { worker } = link;
    const enqueue = (projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void> =>
        link.enqueue(projectId, target, work, notBefore);
    const placed = (nodeId: string): boolean => projects.index.locate(nodeId) !== null;
    const placedElsewhere = (nodeId: string, projectId: string): boolean => {
        const place = projects.index.locate(nodeId);
        return place !== null && place.projectId !== projectId;
    };
    // The parents of this project's tasks that another project of this machine places, as one that used `project` is.
    const parentsElsewhere = (projectId: string): string[] =>
        tasks
            .ofProject(projectId)
            .map((task) => task.parentId)
            .filter((parentId) => placedElsewhere(parentId, projectId));
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
        entries: () => outbox.list(),
        remove: (id) => outbox.remove(id),
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        enqueue,
        alert: (target, nodeId, title, body) => deps.alert(target, nodeId, title, body),
        wake: (chatId) => link.wake(chatId),
        // The same answer the chat itself gives as its turn ends, so a task pauses exactly while a retry is owed.
        retryAt: (chatId, turn, items) =>
            deps.resumeAtReset?.() === true && chats.get(chatId)?.info.resumeAtReset !== false ? limitResumeAt(items, turn, now()) : null,
        ...(deps.now ? { now: deps.now } : {})
    });

    lifecycle.on('exited', (sessionId) => taskWiring.terminals.ended(sessionId));

    // Stopping or deleting a node ends the agents it opened, through the outbox so a restart in between still does.
    const endChildren = wireEndChildren({
        lineage,
        outbox,
        tasks,
        chats,
        sessions,
        enqueue,
        remoteStop: deps.remoteStop,
        placedElsewhere,
        ended: async (nodeIds) => {
            const projectIds = new Set(nodeIds.map((id) => lineage.projectOf(id)).filter((id) => id !== null));
            for (const projectId of projectIds) {
                await projects.hiddenAgents.pruneOrphans(projectId, new Set(placesOf(projects.index.viewsOf(projectId) ?? []).keys()));
            }
        },
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.log ? { log: deps.log } : {})
    });
    lifecycle.on('closed', (nodeId) => endChildren.owe(nodeId).then(() => undefined));
    lifecycle.on('placed', (projectId, ids) => endChildren.places(projectId, ids));

    const summaries = wireSummaries({
        chats,
        projects,
        titleFor: (id) => projects.index.titleFor(id),
        enqueue
    });

    const runParked = resumeRunParked(chats);
    worker.onParked((entry, error) => {
        runParked(entry, error);
        taskWiring.onParked(entry, error);
        summaries.onParked(entry, error);
    });
    worker.handle(
        'start-agent',
        startAgentHandler({
            placed,
            hasChat: (chatId) => chats.get(chatId) !== undefined,
            createChat: (payload) => chats.create(payload),
            composerPreference: (provider) => chats.composerPreferences.for(provider),
            killChat: (chatId) => chats.kill(chatId),
            hasSession: (sessionId) => sessions.get(sessionId) !== undefined,
            createSession: (options) => sessions.create(options),
            killSession: (sessionId) => sessions.kill(sessionId),
            ...(deps.checkCwd ? { checkCwd: deps.checkCwd } : {})
        })
    );
    worker.handle('resume-run', resumeRunHandler(chats));
    // A node that left the document takes its entry along through the prune; one that is still owed runs here.
    worker.handle('resume-limit', (entry) => (placed(entry.target) ? chats.takeUpAfterLimit(entry.target, entry.payload.turnId) : Promise.resolve()));
    worker.handle('background-limit', taskWiring.backgroundLimit);
    // A task another machine gave has no chat here to wake; its result goes back over the link instead.
    worker.handle('wake-parent', (entry) => {
        const task = tasks.get(entry.payload.taskId);
        return task !== undefined && deps.isPeerTask(task) ? Promise.resolve() : taskWiring.wakeParent(entry);
    });
    worker.handle('give-task', taskWiring.giveTask);
    worker.handle('deliver-message', deliverMessageHandler({ notices, chat: chatOpener({ chats, placed }), placed, words: MESSAGE_WORDS }));
    worker.handle('end-children', endChildren.handler);
    worker.handle('deliver-summary', summaries.handler);
    worker.handle('deliver-waiting', taskWiring.deliverWaiting);

    // A node deleted before anyone ran it takes its prompt with it, and a node that is gone frees the count its opener is held to.
    lifecycle.on('placed', (projectId, ids) => {
        void prompts.pruneLeftNodes(projectId, ids).catch((e) => failed('Pruning pending prompts failed', e));
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
        // A parent in another project, which gave its task here with `project`, is not gone from this one.
        const kept = new Set([...ids, ...parentsElsewhere(projectId)]);
        void outbox.prune(projectId, kept).catch((e) => failed('Pruning the outbox failed', e));
        void taskWiring.prune(projectId, new Set([...kept, ...deps.peerParents(projectId)])).catch((e) => failed('Pruning tasks failed', e));
    });

    return { worker, tasks: taskWiring, endChildren, summaries };
}
