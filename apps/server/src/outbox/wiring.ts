import { chatOpener, limitResumeAt } from '@adecore/agents/chat';
import { deliverMessageHandler, OutboxWorker, type AgentLineageStore, type NoticeStore, type OutboxClock, type TaskStore } from '@adecore/agents/coordination';
import type { Task } from '@ruimte/contracts';
import type { PendingPromptStore } from '../agents/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { wireSummaries, type SummaryWiring } from '../chat/summary.ts';
import { MESSAGE_WORDS } from '../context/notices.ts';
import { errorText } from '../error-text.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import { placesOf } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { wireTasks, type TaskWiring } from '../tasks/wiring.ts';
import { wireEndChildren, type EndChildrenWiring } from './end-children.ts';
import type {
    ConnectPeerEntry,
    DeliverRemoteResultEntry,
    OutboxStore,
    OutboxWork,
    RoutineRunEntry,
    RunAfterSettleEntry,
    StartRemoteAgentEntry,
    StopRemoteAgentEntry,
    TakeRemoteResultEntry
} from './outbox.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from './resume-run.ts';
import { startAgentHandler } from './start-agent.ts';

interface OutboxLinkOptions {
    outbox: OutboxStore;
    /* The project a chat lives in, read when a run is owed a resume and not before. */
    projectOf(chatId: string): string | null;
    /* Run after every entry is on disk, for a test that waits on the outbox. */
    onEnqueued?: (work: OutboxWork) => void;
}

/*
 * The chat manager and the worker each need the other: a run a restart interrupted is owed a resume
 * before the worker exists. Both hold this, and `wireOutbox` binds the worker once it is built.
 */
export class OutboxLink {
    /* What the chat manager reports an interrupted run to. */
    readonly onInterruptedRun: ReturnType<typeof oweResume>;
    private readonly onEnqueued: ((work: OutboxWork) => void) | null;
    private readonly outbox: OutboxStore;
    private readonly projectOf: (chatId: string) => string | null;
    private worker: OutboxWorker<OutboxWork> | null = null;

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

    bind(worker: OutboxWorker<OutboxWork>): void {
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
        await this.enqueue(projectId, chatId, { kind: 'resume-limit', payload: { turnId } }, at);
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

    private require(): OutboxWorker<OutboxWork> {
        if (this.worker === null) {
            throw new Error('The outbox is used before it is wired');
        }
        return this.worker;
    }
}

interface OutboxWiringDeps {
    link: OutboxLink;
    outbox: OutboxStore;
    projects: ProjectStore;
    lineage: AgentLineageStore;
    prompts: PendingPromptStore;
    notices: NoticeStore;
    prWatches: Pick<PrWatchStore, 'has' | 'prune'>;
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
    /* Starts the task a chat's project runs after it settled in a worktree; absent on a host that runs no launches, where the entry lapses. */
    runAfterSettle?: (entry: RunAfterSettleEntry) => Promise<void>;
    /* Takes up a routine that is due (`routines/routines.ts`); absent on a host that runs none, where the entry lapses. */
    runRoutine?: (entry: RoutineRunEntry) => Promise<void>;
    /* The reconnect of the link to another machine (`remote/connect-peer.ts`); absent on a host that links to none, where the entry lapses. */
    connectPeer?: (entry: ConnectPeerEntry) => Promise<void>;
    /*
     * The tasks other machines gave this one (`peering/peer-tasks.ts`). Their parent is no chat here, so
     * nothing wakes it, the project's prune keeps them while the machine's canvas stands, and their
     * result is owed to that machine. Absent on a host that takes none.
     */
    peerTasks?: {
        deliver(entry: DeliverRemoteResultEntry): Promise<'wait' | undefined>;
        isPeerTask(task: Task): boolean;
        /* The ids of a project that stand in for the parents of such tasks. */
        parents(projectId: string): ReadonlySet<string>;
    };
    /*
     * The tasks this machine gives agents on other machines (`remote/remote-tasks.ts`). An agent that is
     * ended, or whose node is gone, is stopped there too. Absent on a host that links to none, where the entries lapse.
     */
    remoteTasks?: {
        start(entry: StartRemoteAgentEntry): Promise<'wait' | undefined>;
        stop(entry: StopRemoteAgentEntry): Promise<'wait' | undefined>;
        take(entry: TakeRemoteResultEntry): Promise<'wait' | undefined>;
        oweStop(nodeId: string): Promise<void>;
    };
}

interface OutboxWiring {
    worker: OutboxWorker<OutboxWork>;
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
export function wireOutbox(deps: OutboxWiringDeps): OutboxWiring {
    const { link, outbox, projects, lineage, prompts, notices, prWatches, tasks, chats, sessions, remoteTasks } = deps;
    const enqueue = (projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void> =>
        link.enqueue(projectId, target, work, notBefore);
    const placed = (nodeId: string): boolean => projects.index.locate(nodeId) !== null;
    const placedElsewhere = (nodeId: string, projectId: string): boolean => {
        const place = projects.index.locate(nodeId);
        return place !== null && place.projectId !== projectId;
    };
    // The parents of this project's tasks that another project of this machine places, as one that used `--project` is.
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

    // Stopping or deleting a node ends the agents it opened, through the outbox so a restart in between still does.
    const endChildren = wireEndChildren({
        lineage,
        outbox,
        tasks,
        chats,
        sessions,
        enqueue,
        remoteStop: remoteTasks ? (nodeId) => remoteTasks.oweStop(nodeId) : undefined,
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

    const summaries = wireSummaries({
        chats,
        projects,
        titleFor: (id) => projects.index.titleFor(id),
        enqueue
    });

    const openChat = chatOpener({ chats, placed });
    const runParked = resumeRunParked(chats);
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
            // A task another machine gave has no chat here to wake; its result goes back over the link instead.
            'wake-parent': (entry) => {
                const task = tasks.get(entry.payload.taskId);
                return task !== undefined && deps.peerTasks?.isPeerTask(task) === true ? Promise.resolve() : taskWiring.wakeParent(entry);
            },
            'give-task': taskWiring.giveTask,
            'deliver-message': deliverMessageHandler({
                notices,
                chat: openChat,
                placed,
                words: MESSAGE_WORDS
            }),
            'end-children': endChildren.handler,
            'deliver-summary': summaries.handler,
            'deliver-waiting': taskWiring.deliverWaiting,
            // A watch that ended takes its wake along; a chat in a turn keeps it until the turn ends.
            'deliver-pr-watch': async (entry) => {
                if (!prWatches.has(entry.payload.watchId)) {
                    return;
                }
                const chat = await openChat(entry.target);
                if (chat === null) {
                    return;
                }
                // A chat on its way to another folder takes no turn until it is there.
                if (chat.relocating?.() === true) {
                    return 'wait';
                }
                return chat.wake({ text: entry.payload.text, label: entry.payload.label, taskIds: [] }) ? undefined : 'wait';
            },
            'run-after-settle': (entry) => deps.runAfterSettle?.(entry) ?? Promise.resolve(),
            'connect-peer': (entry) => deps.connectPeer?.(entry) ?? Promise.resolve(),
            'routine-run': (entry) => deps.runRoutine?.(entry) ?? Promise.resolve(),
            'deliver-remote-result': (entry) => deps.peerTasks?.deliver(entry) ?? Promise.resolve(undefined),
            'start-remote-agent': (entry) => remoteTasks?.start(entry) ?? Promise.resolve(undefined),
            'stop-remote-agent': (entry) => remoteTasks?.stop(entry) ?? Promise.resolve(undefined),
            'take-remote-result': (entry) => remoteTasks?.take(entry) ?? Promise.resolve(undefined)
        },
        onParked: (entry, error) => {
            runParked(entry, error);
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
            // A node that ran an agent on another machine and is gone ends that agent as well.
            for (const task of tasks.ofProject(projectId)) {
                if (task.machine !== undefined && task.status === 'open' && !ids.has(task.childId)) {
                    void remoteTasks?.oweStop(task.childId).catch((e) => failed('Stopping an agent on another machine failed', e));
                }
            }
            prWatches.prune(projectId, ids);
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
            // A parent in another project, which gave its task here with `--project`, is not gone from this one.
            const kept = new Set([...ids, ...parentsElsewhere(projectId)]);
            void outbox.prune(projectId, kept).catch((e) => failed('Pruning the outbox failed', e));
            void taskWiring
                .prune(projectId, deps.peerTasks ? new Set([...kept, ...deps.peerTasks.parents(projectId)]) : kept)
                .catch((e) => failed('Pruning tasks failed', e));
        }
    };
}
