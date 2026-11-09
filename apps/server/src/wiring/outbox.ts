import { chatOpener, limitResumeAt, type ChatCore, type LostWork } from '@adecore/agents/chat';
import {
    deliverMessageHandler,
    OutboxWorker,
    oweResume,
    resumeRunHandler,
    resumeRunParked,
    type AgentLineageStore,
    type NoticeStore,
    type Clock,
    type OutboxOutcome,
    type TaskStore
} from '@adecore/agents/coordination';
import type { Task } from '@ruimte/contracts';
import type { PendingPromptStore } from '../canvas/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { MESSAGE_WORDS } from '../context/notices.ts';
import type { NodeLifecycle } from '../node-lifecycle.ts';
import { openerOf } from '../opener.ts';
import { deliverAnswerHandler } from '../outbox/deliver-answer.ts';
import { deliverLostWorkHandler } from '../outbox/deliver-lost-work.ts';
import { wireEndChildren, type EndChildrenWiring } from '../outbox/end-children.ts';
import { OUTBOX_KIND_NAMES, outboxRetries } from '../outbox/kinds/index.ts';
import type { OutboxStore, OutboxWork } from '../outbox/outbox.ts';
import { startAgentHandler } from '../outbox/start-agent.ts';
import { wireSummaries, type SummaryWiring } from '../outbox/summary.ts';
import { placesOf } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { wireTasks, type TaskWiring } from '../tasks/wiring.ts';
import type { WiringObservers } from './seams.ts';

interface OutboxLinkOptions {
    outbox: OutboxStore;
    /* The project a chat lives in, read when a run is owed a resume and not before. */
    projectOf(chatId: string): string | null;
    clock: Clock;
    observers: Pick<WiringObservers, 'enqueued'>;
}

/*
 * The worker and what the chat manager needs of it before the daemon is wired: a run a restart
 * interrupted is owed a resume as the manager starts. The worker has no handlers yet; each feature
 * adds its own where it is wired (`worker.handle`), and the worker refuses to start without all.
 */
export class OutboxLink {
    readonly worker: OutboxWorker<OutboxWork>;
    readonly onInterruptedRun: ReturnType<typeof oweResume>;
    private readonly observers: Pick<WiringObservers, 'enqueued'>;
    private readonly outbox: OutboxStore;
    private readonly projectOf: (chatId: string) => string | null;

    constructor(options: OutboxLinkOptions) {
        this.worker = new OutboxWorker({
            store: options.outbox,
            kinds: OUTBOX_KIND_NAMES,
            retries: outboxRetries(),
            clock: options.clock
        });
        this.observers = options.observers;
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
        this.observers.enqueued(work);
    }

    wake(chatId: string): void {
        this.worker.wake(chatId);
    }

    /* Owes the chat the turn that tells it how a person answered its card; a chat no project holds is owed nothing. */
    async oweAnswer(chatId: string, answer: { text: string; label: string }): Promise<void> {
        const projectId = this.projectOf(chatId);
        if (projectId === null) {
            return;
        }
        await this.enqueue(projectId, chatId, { kind: 'deliver-answer', payload: answer });
    }

    /*
     * Owes an idle chat the turn that tells it which background commands a restart took, once per note. A
     * chat that lost only subagents or workflows, a task's child (whose parent hears through `background-limit`)
     * and a chat no project holds are owed nothing.
     */
    async oweLostWork(chatId: string, lost: LostWork, taskChild: boolean): Promise<void> {
        const projectId = this.projectOf(chatId);

        if (projectId === null || taskChild || lost.resumed || lost.commands.length === 0) {
            return;
        }

        if (this.outbox.ofKind('deliver-lost-work').some((entry) => entry.target === chatId && entry.payload.noteId === lost.noteId)) {
            return;
        }

        await this.enqueue(projectId, chatId, { kind: 'deliver-lost-work', payload: { noteId: lost.noteId } });
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
    chats: ChatCore;
    chatManager: ChatManager;
    sessions: SessionManager;
    lifecycle: NodeLifecycle;
    alert(target: 'chat' | 'terminal', nodeId: string, title: string, body: string): void;
    now(): number;
    observers: Pick<WiringObservers, 'dropped' | 'failed' | 'log'>;
    /* Refuses a directory an agent node may not start in, the same check the managers make. */
    checkCwd(nodeId: string, cwd: string): Promise<void>;
    /* The machine's switch for taking a limited chat up again on a clock. */
    resumeAtReset(): boolean;
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
    /* Holds a wake for a chat in a closed project, which waits until the project opens again; for the features that wake a chat. */
    unlessClosed<Entry extends { target: string }>(handler: (entry: Entry) => Promise<OutboxOutcome>): (entry: Entry) => Promise<OutboxOutcome>;
}

/*
 * What the outbox drives for the chats and tasks.
 * The kinds of work the other features owe are handled where those are wired.
 */
export function wireOutbox(deps: OutboxWiringDeps): OutboxWiring {
    const { link, outbox, projects, lineage, prompts, notices, tasks, chats, chatManager, sessions, lifecycle } = deps;
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
    const { now, observers } = deps;
    const failed = (what: string, error: unknown): void => observers.failed(what, error);

    const taskWiring = wireTasks({
        tasks,
        chats: chatManager,
        placed,
        entries: () => outbox.list(),
        remove: (id) => outbox.remove(id),
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        enqueue,
        alert: (target, nodeId, title, body) => deps.alert(target, nodeId, title, body),
        wake: (chatId) => link.wake(chatId),
        // The same answer the chat itself gives as its turn ends, so a task pauses exactly while a retry is owed.
        retryAt: (chatId, turn, items) => (deps.resumeAtReset() && chats.get(chatId)?.info.resumeAtReset !== false ? limitResumeAt(items, turn, now()) : null),
        now
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
        now,
        log: observers.log
    });
    lifecycle.on('closed', (nodeId) => endChildren.owe(nodeId).then(() => undefined));
    lifecycle.on('placed', (projectId, ids) => endChildren.places(projectId, ids));

    const summaries = wireSummaries({
        chats: chatManager,
        projects,
        titleFor: (id) => projects.index.titleFor(id),
        enqueue
    });

    // A peer and a routine start in a project under Recent, and nobody comes to open it for them.
    const workOfPeerOrRoutine = (nodeId: string): boolean => {
        const seen = new Set<string>();
        let current: string | null = nodeId;

        while (current !== null && !seen.has(current)) {
            seen.add(current);
            const hiddenOpener: string | undefined = projects.hiddenAgents.get(current)?.openedBy;

            if (lineage.peerOf(current) !== null || (hiddenOpener !== undefined && openerOf(hiddenOpener).kind === 'routine')) {
                return true;
            }

            current = lineage.madeBy(current) ?? hiddenOpener ?? null;
        }

        return false;
    };

    const openChat = chatOpener({ chats, placed });

    // Closing keeps a chat's record for the next open, so nothing may start its CLI while every project that places it is under Recent.
    const unlessClosed =
        <Entry extends { target: string }>(handler: (entry: Entry) => Promise<OutboxOutcome>) =>
        async (entry: Entry): Promise<OutboxOutcome> => {
            const placing = projects.index.projectsPlacing(entry.target);

            if (placing.length === 0 || workOfPeerOrRoutine(entry.target)) {
                return handler(entry);
            }

            for (const projectId of placing) {
                const outcome = await projects.runWake(projectId, async (): Promise<OutboxOutcome | 'closed'> => {
                    if (await projects.isClosed(projectId)) {
                        return 'closed';
                    }

                    // A stored chat takes I/O to load, in which the project may start closing, so it loads before the last look.
                    await openChat(entry.target);

                    return projects.isClosing(projectId) ? 'closed' : handler(entry);
                });

                if (outcome !== 'closed') {
                    return outcome;
                }
            }

            return 'wait';
        };

    const wakeParent = unlessClosed(taskWiring.wakeParent);
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
            checkCwd: deps.checkCwd
        })
    );
    worker.handle('resume-run', resumeRunHandler(chats));
    // A node that left the document takes its entry along through the prune; one that is still owed runs here.
    worker.handle(
        'resume-limit',
        unlessClosed((entry) => (placed(entry.target) ? chats.takeUpAfterLimit(entry.target, entry.payload.turnId) : Promise.resolve()))
    );
    worker.handle('background-limit', taskWiring.backgroundLimit);
    // A task another machine gave has no chat here to wake; its result goes back over the link instead.
    worker.handle('wake-parent', (entry) => {
        const task = tasks.get(entry.payload.taskId);
        return task !== undefined && deps.isPeerTask(task) ? Promise.resolve() : wakeParent(entry);
    });
    worker.handle('give-task', taskWiring.giveTask);
    worker.handle('deliver-message', unlessClosed(deliverMessageHandler({ notices, chat: openChat, placed, words: MESSAGE_WORDS })));
    worker.handle('end-children', endChildren.handler);
    worker.handle('deliver-summary', summaries.handler);
    worker.handle('deliver-waiting', taskWiring.deliverWaiting);
    worker.handle('deliver-answer', unlessClosed(deliverAnswerHandler({ openChat })));
    worker.handle(
        'deliver-lost-work',
        unlessClosed(
            deliverLostWorkHandler({
                openChat,
                endedAt: (chatId) => lineage.endedAt(chatId),
                owesWake: (chatId, noteId) => chats.get(chatId)?.owesRestartWake(noteId) ?? false
            })
        )
    );

    // A node deleted before anyone ran it takes its prompt with it, and a node that is gone frees the count its opener is held to.
    lifecycle.on('placed', (projectId, ids) => {
        void prompts.pruneLeftNodes(projectId, ids).catch((e) => failed('Pruning pending prompts failed', e));
        for (const forkId of lineage.forksLeaving(projectId, ids)) {
            observers.dropped(chatManager.dropUnspokenFork(forkId));
        }
        void lineage.prune(projectId, ids).catch((e) => failed('Pruning agent lineage failed', e));
        void notices.prune(projectId, ids).catch((e) => failed('Pruning waiting messages failed', e));
        // A parent in another project, which gave its task here with `project`, is not gone from this one.
        const kept = new Set([...ids, ...parentsElsewhere(projectId)]);
        void outbox.prune(projectId, kept).catch((e) => failed('Pruning the outbox failed', e));
        void taskWiring.prune(projectId, new Set([...kept, ...deps.peerParents(projectId)])).catch((e) => failed('Pruning tasks failed', e));
    });

    // What was held back for a closed project runs once it opens again.
    projects.onReopened((projectId) => {
        for (const entry of outbox.list()) {
            if (projects.index.projectsPlacing(entry.target).includes(projectId)) {
                worker.wake(entry.target);
            }
        }
    });

    return { worker, tasks: taskWiring, endChildren, summaries, unlessClosed };
}
