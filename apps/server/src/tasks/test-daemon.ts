import type { AgentKind, ServerFrame } from '@ruimte/contracts';
import { agentStates } from '../agents/agent-state.ts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { AgentStart, CanvasHost } from '../canvas/verb.ts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { chatForkDeps, forkChat, readForkInfo } from '../chat/fork.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { fakeCodex } from '../chat/fake-codex.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { turnFromMessage } from '../context/deliver-message.ts';
import { deliverNotice, NoticeStore, renderNotice, showNotices } from '../context/notices.ts';
import { Dispatcher } from '../dispatcher.ts';
import { Checkpoints, type CheckpointService } from '../git/checkpoints.ts';
import { worktreeAgents } from '../git/worktree-agents.ts';
import { worktreeHost } from '../git/worktree-host.ts';
import { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import { registerChatHandlers } from '../handlers/chat.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { registerPlanHandlers } from '../handlers/plan.ts';
import { registerTaskHandlers } from '../handlers/tasks.ts';
import type { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import type { OutboxWorker } from '../outbox/outbox-worker.ts';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { TaskWiring } from './wiring.ts';
import { PlanStore } from '../plans/plan-store.ts';
import { nodeMode, startAgentWork } from '../outbox/start-agent.ts';
import { OutboxLink, wireOutbox } from '../outbox/wiring.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager } from '../sessions/manager.ts';
import { TaskStore } from './task-store.ts';

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

/* One run of the daemon over a home, wired the way `daemon.ts` wires it, with fakes where a process would be. */
export interface TestDaemon {
    tasks: TaskStore;
    notices: NoticeStore;
    lineage: AgentLineageStore;
    outbox: OutboxStore;
    worker: OutboxWorker;
    sessions: SessionManager;
    chats: ChatManager;
    plans: PlanStore;
    adapter: FakePtyAdapter;
    claude: InProcessCli;
    codex: InProcessCli;
    wiring: TaskWiring;
    endChildren: EndChildrenWiring;
    host: CanvasHost;
    alerts: string[];
    /* A request over the wire from one client, answered by the same handlers a socket reaches. */
    request(type: string, payload: unknown): Promise<ServerFrame>;
    /* Resolves once what a deleted node took along (an unused fork's record) is gone. */
    pruned(): Promise<void>;
    /* Resolves once `check` holds, looked at again on every event and every task written. */
    until(check: () => boolean): Promise<void>;
    stop(): Promise<void>;
}

export interface TestDaemonOptions {
    home: string;
    store: ProjectStore;
    clock: ManualClock;
    checkpoints?: CheckpointService;
    /* Real worktrees for the verbs; without them a project is in no repository. */
    worktrees?: Worktrees;
    /* The CLIs this machine says it has; Claude Code alone unless a test needs another. */
    installed?: AgentKind[];
}

export const bootTestDaemon = async ({ home, store, clock, checkpoints, worktrees, installed = ['claude'] }: TestDaemonOptions): Promise<TestDaemon> => {
    const prompts = new PendingPromptStore(home);
    await prompts.load();
    const lineage = new AgentLineageStore(home);
    await lineage.load();
    const outbox = new OutboxStore(home);
    await outbox.load();
    const tasks = new TaskStore(home);
    await tasks.load();
    const notices = new NoticeStore(home, () => clock.now());
    await notices.load();
    const adapter = new FakePtyAdapter();
    const claude = inProcess(fakeClaude);
    const codex = inProcess(fakeCodex);
    const sessions = new SessionManager({ adapter, env: { HOME: home, PATH: process.env.PATH }, firstPrompt: (id) => prompts.take(id) });
    const attachments = new AttachmentStore(home);
    const drops: Promise<void>[] = [];
    const outboxLink = new OutboxLink({
        outbox,
        projectOf: (chatId) => store.index.locate(chatId)?.projectId ?? null,
        // Owed after the entry is written, so a wait on the outbox looks again once it is there.
        onEnqueued: () => recheck()
    });
    const plans = new PlanStore(home, { now: () => clock.now() });
    const chats = new ChatManager({
        providers,
        store: new ChatStore(home, attachments),
        attachments,
        ...(checkpoints ? { checkpoints } : {}),
        spawn: (options) => (options.command[0]?.endsWith('codex') ? codex.spawn(options) : claude.spawn(options)),
        env: { PATH: process.env.PATH, HOME: home },
        firstPrompt: (id) => prompts.take(id),
        onInterruptedRun: outboxLink.onInterruptedRun,
        messages: (chatId) => notices.take(chatId).map(renderNotice),
        taskRows: (chatId) => tasks.ofParent(chatId),
        endedAt: (chatId) => lineage.endedAt(chatId),
        plans
    });
    let waiters: Array<{ check: () => boolean; resolve: () => void }> = [];
    const recheck = (): void => {
        const waiting = waiters;
        waiters = [];
        for (const waiter of waiting) {
            if (waiter.check()) {
                waiter.resolve();
            } else {
                waiters.push(waiter);
            }
        }
    };
    const alerts: string[] = [];
    const outboxWiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects: store,
        lineage,
        prompts,
        notices,
        tasks,
        chats,
        sessions,
        alert: (_target, nodeId, title, body) => alerts.push(`${nodeId}\t${title}\t${body}`),
        clock,
        now: () => clock.now(),
        log: () => undefined,
        onDropped: (drop) => drops.push(drop),
        onFailed: () => undefined
    });
    const worker = outboxWiring.worker;
    const wiring = outboxWiring.tasks;
    const endChildren = outboxWiring.endChildren;
    const summaries = outboxWiring.summaries;
    endChildren.start();
    sessions.onProcessChange = (sessionId, phase) => {
        if (phase === 'changed' && sessions.get(sessionId)?.exited !== false) {
            wiring.coordinator.terminalEnded(sessionId);
        }
    };
    sessions.observe((event) => wiring.coordinator.sessionEvent(event));
    store.index.onPlaces = outboxWiring.places;

    sessions.observe(recheck);
    chats.observe(recheck);
    // A task is written after the event that settled it, so the wait looks again once it is on disk.
    tasks.onChange(() => queueMicrotask(recheck));

    const modes = {
        chatMode: (id: string) => chats.get(id)?.info.runtimeMode,
        launch: (id: string) => sessions.get(id)?.launch,
        reportedMode: (id: string) => sessions.get(id)?.reportedMode
    };
    const host: CanvasHost = {
        locate: (id) => store.index.locate(id),
        read: (id) => store.read(id),
        revision: (id) => store.revision(id),
        mutate: (id, apply, expectedRev) => store.mutate(id, apply, expectedRev),
        worktreePaths: async (folder) => (worktrees ? (await worktrees.list(folder).catch(() => [])).map((worktree) => worktree.path) : []),
        installedAgents: async () => installed,
        holdPrompt: (id, nodeId, prompt) => prompts.put(id, nodeId, prompt),
        startAgent: (start: AgentStart) => outboxLink.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: async (folder) => (worktrees ? worktrees.branches(folder).catch(() => null) : null),
        addWorktree: (folder, branch, projectId) =>
            worktrees ? worktrees.add(folder, branch, { madeBy: 'verb', projectId }) : Promise.reject(new Error('no worktrees here')),
        claimWorktree: async (folder, path, nodeId) => worktrees?.claim(folder, path, nodeId),
        removeWorktree: async (folder, path) => worktrees?.remove(folder, path),
        ...(worktrees
            ? {
                  worktrees: worktreeHost(
                      worktrees,
                      new WorktreeMerge(
                          worktrees,
                          worktreeAgents({
                              chats: () => chats.list(),
                              sessions: () => sessions.list(),
                              stopNode: (nodeId, reason) => endChildren.stopNode(nodeId, reason)
                          })
                      )
                  )
              }
            : {}),
        depthOf: (nodeId) => lineage.depthOf(nodeId),
        openedCount: (callerId) => lineage.openedCount(callerId),
        recordMade: (record) => lineage.put(record),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => false,
        showView: () => false,
        endSession: async (kind, nodeId) => {
            await endChildren.owe(nodeId);
            await (kind === 'terminal' ? sessions.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
        },
        notify: async (notice) => {
            const delivery = await deliverNotice(
                notices,
                {
                    terminal: (id) => {
                        const session = sessions.get(id);
                        return session && !session.exited ? { agent: session.agent, notice: (text: string) => session.notice(text) } : null;
                    },
                    chat: async (id) => {
                        const session = chats.get(id);
                        if (session) {
                            return session.info.activeTurnId === null ? 'idle' : 'running';
                        }
                        return (await chats.hasStored(id)) ? 'idle' : 'none';
                    },
                    fromMessage: (id) => {
                        const session = chats.get(id);
                        return session !== undefined && turnFromMessage(session.thread.list(), session.info.activeTurnId);
                    }
                },
                notice
            );
            await showNotices(notices, { has: (id) => chats.hasStored(id), note: (id, text) => chats.addNote(id, 'info', text) }, notice.targetId);
            if (delivery.wake) {
                await outboxLink.enqueue(notice.projectId, notice.targetId, { kind: 'deliver-message', payload: { from: notice.from } });
            }
            return delivery;
        },
        writeDiagram: () => Promise.reject(new Error('not used here')),
        tasks: wiring.host,
        plans,
        agents: agentStates({ outbox, lineage, chats, sessions })
    };

    const dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, sessions, endChildren.owe);
    const forkDeps = chatForkDeps({
        chats,
        host,
        titleFor: (id) => store.index.titleFor(id),
        lineage,
        ...(worktrees ? { worktrees } : {}),
        ...(checkpoints instanceof Checkpoints ? { checkpoints } : {})
    });
    registerChatHandlers(dispatcher, chats, providers, endChildren.owe, endChildren.stopNode, {
        fork: (payload) => forkChat(forkDeps, payload),
        info: (payload) => readForkInfo(forkDeps, payload),
        summarize: (chatId) => summaries.summarize(chatId)
    });
    registerTaskHandlers(dispatcher, tasks, endChildren.children);
    registerPlanHandlers(dispatcher, plans);

    return {
        tasks,
        notices,
        lineage,
        outbox,
        worker,
        sessions,
        chats,
        plans,
        adapter,
        claude,
        codex,
        wiring,
        endChildren,
        host,
        alerts,
        request: async (type, payload) => {
            const frames: ServerFrame[] = [];
            await dispatcher.handle({ id: 'client-1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
            return frames[0]!;
        },
        pruned: async () => {
            await Promise.all(drops);
        },
        until: (check) => (check() ? Promise.resolve() : new Promise((resolve) => waiters.push({ check, resolve }))),
        stop: async () => {
            // The order the daemon's own shutdown takes: nothing that dies with it settles a task.
            worker.stop();
            wiring.coordinator.stop();
            summaries.coordinator.stop();
            chats.persistAllSync();
            await chats.shutdown();
            sessions.killAll();
            for (const info of chats.list()) {
                chats.get(info.chatId)?.dispose();
            }
        }
    };
};

/* A verb the node `caller` runs, the way `ruimte-context` posts it; the token is the caller's id. */
export const runVerb = async (daemon: Pick<TestDaemon, 'host'>, caller: string, name: string, argv: string[]): Promise<string[]> => {
    const path = `${CANVAS_PATH}/${name}`;
    const response = await handleCanvasRequest(
        new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: `Bearer ${caller}` }, body: JSON.stringify({ argv }) }),
        path,
        { targetForToken: (token) => token, host: daemon.host }
    );
    return (await response.text()).trim().split('\n');
};
