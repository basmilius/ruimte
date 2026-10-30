import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_SIZE, type AgentKind, type ChatItem, type ChatTurnItem, type ProjectContent, type ServerFrame } from '@ruimte/contracts';
import { agentStates } from '../agents/agent-state.ts';
import { chatRequests, AgentLineageStore, NoticeNotes, NoticeStore, restartBackgroundLimits, TaskStore } from '@adecore/agents/coordination';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { CanvasHost, VisualHost } from '../canvas/verb.ts';
import { AttachmentStore, ChatStore, VisualStore } from '@adecore/agents/chat';
import { ChatManager } from '../chat/chat-manager.ts';
import { continueOn } from '../chat/continue-on.ts';
import { chatForkDeps, forkChat, forkForAgent, readForkInfo, readHandoff } from '../chat/fork.ts';
import { fakeClaude, fakeCodex, inProcess, type FakeCli, type InProcessCli } from '@adecore/agents/testing';
import { agentMessages } from '../context/agent-messages.ts';
import { MESSAGE_WORDS } from '../context/notices.ts';
import { Dispatcher } from '../dispatcher.ts';
import { Checkpoints, type CheckpointService } from '../git/checkpoints.ts';
import { worktreeAgents } from '../git/worktree-agents.ts';
import { checkoutHost, worktreeHost } from '../git/worktree-host.ts';
import { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import { PrWatchStore } from '../github/pr-watch.ts';
import type { GhRunner } from '../git/github.ts';
import { registerChatHandlers } from '../handlers/chat.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { registerPlanHandlers } from '../handlers/plan.ts';
import { registerTaskHandlers } from '../handlers/tasks.ts';
import type { ManualClock } from '@adecore/agents/testing';
import { OutboxStore, type OutboxWork } from '../outbox/outbox.ts';
import type { OutboxWorker } from '@adecore/agents/coordination';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { TaskWiring } from './wiring.ts';
import { isPlanFileName, PlanStore } from '../plans/plan-store.ts';
import { agentChatOpening, agentStartHost } from '../outbox/start-agent.ts';
import { OutboxLink, wireOutbox } from '../outbox/wiring.ts';
import { chatAccess } from '../wiring/canvas-host.ts';
import { projectAccountChooser } from '../projects/project-accounts.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { openedAgentCount } from '../agents/hidden-agents.ts';
import type { AccountLaunches, ProviderAccountsService } from '@adecore/agents/providers';
import type { LimitsUpdate } from '@adecore/agents/usage';
import { ProviderRegistry } from '../providers/registry.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import type { PtyAdapter } from '../pty/pty.ts';
import { SessionManager } from '../sessions/manager.ts';
import { TEST_GIT_BASH } from '../sessions/test-helpers.ts';
import { agentVisuals } from '../visuals/agent-host.ts';
import { RemoteTasks, type RemoteTasksDeps } from '../remote/remote-tasks.ts';
import { registerPeerTaskHandlers } from '../handlers/peer-tasks.ts';
import type { PeerLinks } from '../peering/links.ts';
import { UntrustedFolders } from '../peering/untrusted.ts';
import { PeerTasks, type PeerTasksDeps } from '../peering/peer-tasks.ts';
import { BundleStore } from '../git/bundles.ts';
import { StartClaims } from '../actions/start-claims.ts';
import { untilChecked } from '../until-test-helpers.ts';

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

/* One run of the daemon over a home, wired the way `daemon.ts` wires it, with fakes where a process would be. */
export interface TestDaemon {
    tasks: TaskStore;
    notices: NoticeStore;
    lineage: AgentLineageStore;
    outbox: OutboxStore;
    prWatches: PrWatchStore;
    worker: OutboxWorker<OutboxWork>;
    sessions: SessionManager;
    chats: ChatManager;
    plans: PlanStore;
    visuals: VisualStore;
    /* The fake terminals, which stay empty when `ptyAdapter` brings real ones. */
    adapter: FakePtyAdapter;
    dispatcher: Dispatcher;
    claude: InProcessCli;
    codex: InProcessCli;
    /* The environment of every chat CLI started, oldest first. */
    chatEnvs: Array<Record<string, string>>;
    /* The command line of every chat CLI started, oldest first. */
    chatCommands: string[][];
    wiring: TaskWiring;
    endChildren: EndChildrenWiring;
    /* The tasks other machines gave, when the daemon takes any. */
    peerTasks: PeerTasks | null;
    /* The tasks this machine gave other machines, when it gives any. */
    remoteTasks: RemoteTasks | null;
    host: CanvasHost;
    alerts: string[];
    /* Every piece of work owed since boot, kept after the worker took it off the outbox. */
    enqueued: OutboxWork[];
    /* A request over the wire from one client, answered by the same handlers a socket reaches. */
    request(type: string, payload: unknown): Promise<ServerFrame>;
    /* Resolves once what a deleted node took along (an unused fork's record) is gone. */
    pruned(): Promise<void>;
    /* Resolves once `check` holds, looked at again on every event and every task written. */
    until(check: () => boolean): Promise<void>;
    stop(): Promise<void>;
}

interface TestDaemonOptions {
    home: string;
    store: ProjectStore;
    clock: ManualClock;
    /* What runs a terminal; the fake adapter unless a measurement needs real processes. */
    ptyAdapter?: PtyAdapter;
    checkpoints?: CheckpointService;
    /* Real worktrees for the verbs; without them a project is in no repository. */
    worktrees?: Worktrees;
    /* The CLIs this machine says it has; Claude Code alone unless a test needs another. */
    installed?: AgentKind[];
    /* What runs as Claude Code; the plain fake unless a test needs one that misbehaves. */
    claudeCli?: FakeCli;
    /* What runs as Codex; the plain fake unless a test needs another. */
    codexCli?: FakeCli;
    /* The machine's switches a test flips; resuming after a limit is off and visual replies on, as on a fresh machine. */
    machine?: { resumeAtReset: boolean; visualReplies?: boolean };
    /* The accounts of the CLIs; without them every CLI has only its default account. A project's choice of accounts needs their snapshot. */
    accounts?: AccountLaunches & Partial<Pick<ProviderAccountsService, 'snapshot'>>;
    /* The environment every CLI starts from. */
    env?: Record<string, string | undefined>;
    /* What a running turn says about the plan of its account. */
    onLimits?: (update: LimitsUpdate) => void;
    /* How pages are previewed and measured; without it a preview is refused and a page shown without heights. */
    visualRender?: Pick<VisualHost, 'preview' | 'measure'>;
    /* What `gh` answers a pull request watch; without it every call fails. */
    gh?: GhRunner;
    /* The machines this one gives tasks to: which are linked, the link to each and the reconnect owed while one is away. */
    remote?: {
        machines: NonNullable<CanvasHost['remote']>['machines'];
        connections: RemoteTasksDeps['connections'];
        reconnect: RemoteTasksDeps['reconnect'];
        git?: RemoteTasksDeps['git'];
        folderOf?: RemoteTasksDeps['folderOf'];
    };
    /* This machine as the one other machines work in: the links they have here, its git, and how it tells one that a task settled. */
    peer?: {
        links: PeerLinks;
        git: PeerTasksDeps['git'];
        notify: PeerTasksDeps['notify'];
    };
}

export async function bootTestDaemon({
    home,
    store,
    clock,
    ptyAdapter,
    checkpoints,
    worktrees,
    installed = ['claude'],
    claudeCli = fakeClaude,
    codexCli = fakeCodex,
    machine = { resumeAtReset: false },
    accounts,
    env = { PATH: process.env.PATH, HOME: home },
    onLimits,
    visualRender = {},
    gh = () => Promise.resolve({ code: 1, stdout: '', stderr: 'no gh in this test' }),
    remote,
    peer
}: TestDaemonOptions): Promise<TestDaemon> {
    await store.hiddenAgents.load();
    const projectAccount = projectAccountChooser({
        projectOf: (id) => store.index.locate(id)?.projectId ?? null,
        accountsOf: (projectId) => store.index.accountsOf(projectId),
        providerAccounts: { snapshot: () => accounts?.snapshot?.() ?? { accounts: {}, statuses: [] } },
        limits: () => null,
        now: () => clock.now()
    });
    const prompts = new PendingPromptStore(home);
    await prompts.load();
    const lineage = new AgentLineageStore(home);
    await lineage.load();
    const outbox = new OutboxStore(home);
    await outbox.load();
    await restartBackgroundLimits(outbox, clock.now());
    const tasks = new TaskStore(home);
    await tasks.load();
    const notices = new NoticeStore(home, () => clock.now());
    await notices.load();
    const adapter = new FakePtyAdapter();
    const claude = inProcess(claudeCli);
    const codex = inProcess(codexCli);
    const sessions = new SessionManager({
        personShell: () => 'bash',
        adapter: ptyAdapter ?? adapter,
        env,
        firstPrompt: async (id) => (await prompts.take(id))?.prompt ?? null,
        modeCeiling: (sessionId) => lineage.ceilingOf(sessionId),
        ...(accounts ? { accounts } : {}),
        openingAccount: (sessionId, kind, named) => projectAccount(sessionId, kind, named)?.account ?? named ?? accounts?.defaultFor?.(kind),
        findGitBash: () => TEST_GIT_BASH
    });
    const attachments = new AttachmentStore(home);
    const drops: Promise<void>[] = [];
    const enqueued: OutboxWork[] = [];
    const outboxLink = new OutboxLink({
        outbox,
        projectOf: (chatId) => store.index.locate(chatId)?.projectId ?? null,
        /* Owed after the entry is written, so a wait on the outbox looks again once it is there. A
           running worker may already have taken the entry off by then, so the work is kept too. */
        onEnqueued: (work) => {
            enqueued.push(work);
            recheck();
        }
    });
    const plans = new PlanStore(home, { now: () => clock.now() });
    const visuals = new VisualStore(home, attachments);
    const chatEnvs: Array<Record<string, string>> = [];
    const chatCommands: string[][] = [];
    const untrusted = new UntrustedFolders({
        lineage,
        folders: () => (peer?.links ?? store.peers).worktreeFolders(),
        cwdOf: (nodeId) => chats.get(nodeId)?.info.cwd ?? sessions.get(nodeId)?.cwd ?? null
    });
    const chats = new ChatManager({
        providers,
        projectAccount,
        store: new ChatStore(home, { attachments, isSidecar: isPlanFileName }),
        attachments,
        ...(checkpoints ? { checkpoints } : {}),
        spawn: (options) => {
            chatEnvs.push(options.env);
            chatCommands.push([...options.command]);
            return options.command[0]?.endsWith('codex') ? codex.spawn(options) : claude.spawn(options);
        },
        env,
        ...(accounts ? { accounts } : {}),
        ...(onLimits ? { onLimits } : {}),
        firstPrompt: (id) => prompts.take(id),
        openingAgent: agentChatOpening(outbox, (provider) => chats.composerPreferences.for(provider)),
        onInterruptedRun: outboxLink.onInterruptedRun,
        standalone: (id) => store.index.locate(id)?.canvasId === null,
        messageNotes: (chatId) => new NoticeNotes(notices, chatId, MESSAGE_WORDS),
        taskRows: (chatId) => tasks.ofParent(chatId),
        dropWakes: (chatId) => tasks.dropWake(chatId),
        endChildren: (chatId) => endChildren.stopNode(chatId, 'a person cleared this chat'),
        endedAt: (chatId) => lineage.endedAt(chatId),
        peerChat: (chatId) => untrusted.node(chatId),
        plans,
        visuals,
        visualReplies: () => machine.visualReplies !== false,
        limitResume: {
            allowed: () => machine.resumeAtReset,
            now: () => clock.now(),
            owe: (chatId, turnId, at) => outboxLink.oweLimitResume(chatId, turnId, at),
            lapse: (chatId) => outboxLink.lapseLimitResume(chatId),
            owed: (chatId) => outboxLink.owesLimitResume(chatId)
        }
    });
    const { until, recheck } = untilChecked();
    const alerts: string[] = [];
    const prWatches = new PrWatchStore({
        path: `${home}/pr-watches.json`,
        clock,
        gh,
        random: () => 0.5,
        enqueue: (projectId, chatId, work) => outboxLink.enqueue(projectId, chatId, work),
        entries: () => outbox.list(),
        removeEntry: (id) => outbox.remove(id)
    });
    let remoteTasks: RemoteTasks | null = null;
    let peerTasks: PeerTasks | null = null;
    const outboxWiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects: store,
        lineage,
        prompts,
        notices,
        prWatches,
        tasks,
        chats,
        sessions,
        alert: (_target, nodeId, title, body) => alerts.push(`${nodeId}\t${title}\t${body}`),
        clock,
        now: () => clock.now(),
        log: () => undefined,
        onDropped: (drop) => drops.push(drop),
        onFailed: () => undefined,
        resumeAtReset: () => machine.resumeAtReset,
        ...(peer
            ? {
                  peerTasks: {
                      deliver: (entry) => peerTasks!.deliver(entry),
                      isPeerTask: (task) => peerTasks!.isPeerTask(task),
                      parents: (projectId) => peer.links.canvasIdsOf(projectId)
                  }
              }
            : {}),
        ...(remote
            ? {
                  remoteTasks: {
                      start: (entry) => remoteTasks!.start(entry),
                      stop: (entry) => remoteTasks!.stop(entry),
                      take: (entry) => remoteTasks!.take(entry),
                      oweStop: (nodeId) => remoteTasks!.oweStop(nodeId)
                  }
              }
            : {})
    });
    if (remote) {
        remoteTasks = new RemoteTasks({
            connections: remote.connections,
            reconnect: remote.reconnect,
            tasks,
            coordinator: outboxWiring.tasks.coordinator,
            placed: (nodeId) => store.index.locate(nodeId) !== null,
            git:
                remote.git ??
                (() => {
                    throw new Error('no git in this test');
                }),
            folderOf: remote.folderOf ?? ((projectId) => store.index.folderOf(projectId)),
            labelOf: (projectId, machineId) => remote.machines(projectId).find((machineLink) => machineLink.machineId === machineId)?.label ?? 'machine',
            untrustFolder: (path, branch) => store.peers.untrustFolder(path, branch),
            outbox,
            enqueue: (projectId, target, work) => outboxLink.enqueue(projectId, target, work),
            wake: (target) => outboxWiring.worker.wake(target),
            now: () => clock.now()
        });
    }
    const { worker, tasks: wiring, endChildren, summaries } = outboxWiring;
    await wiring.recover();
    endChildren.start();
    sessions.onProcessChange = (sessionId, phase) => {
        if (phase === 'changed' && sessions.get(sessionId)?.exited !== false) {
            wiring.terminals.ended(sessionId);
        }
    };
    sessions.observe((event) => wiring.terminals.sessionEvent(event));
    store.index.onPlaces = outboxWiring.places;

    sessions.observe(recheck);
    chats.observe(recheck);
    // A task is written after the event that settled it, so the wait looks again once it is on disk.
    tasks.onChange(() => queueMicrotask(recheck));

    const enqueue = (projectId: string, nodeId: string, work: OutboxWork): Promise<void> => outboxLink.enqueue(projectId, nodeId, work);
    const startClaims = new StartClaims(home);
    await startClaims.load();
    const host: CanvasHost = {
        projects: store,
        hiddenAgents: store.hiddenAgents,
        startClaims,
        lineage,
        untrusted,
        starts: agentStartHost({
            installed: async () => installed,
            prompts,
            enqueue,
            chats,
            sessions,
            lineage,
            openedCount: (callerId) => openedAgentCount({ lineage, hiddenAgents: store.hiddenAgents, tasks, outbox, chats, sessions }, callerId),
            accountsOff: (projectId, kind) => store.index.accountsOf(projectId)?.[kind]?.off ?? []
        }),
        ...(remote
            ? {
                  remote: {
                      machines: remote.machines,
                      give: (projectId: string, nodeId: string, payload) => enqueue(projectId, nodeId, { kind: 'start-remote-agent', payload })
                  }
              }
            : {}),
        checkouts: worktrees
            ? checkoutHost(worktrees)
            : {
                  paths: async () => [],
                  branches: async () => null,
                  add: () => Promise.reject(new Error('no worktrees here')),
                  claim: async () => undefined,
                  remove: async () => undefined
              },
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
        machine: { agentsDeleteAnyView: false, nodeSize: (kind) => NODE_SIZE[kind] },
        endSession: async (kind, nodeId) => {
            await endChildren.owe(nodeId);
            await (kind === 'terminal' ? sessions.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
        },
        messages: {
            ...agentMessages({ notices, sessions, chats, projects: store, enqueue, push: () => ({ notify: () => undefined }) }),
            alert: () => undefined
        },
        diagrams: { write: () => Promise.reject(new Error('not used here')) },
        tasks: wiring.host,
        plans,
        agents: agentStates({ outbox, lineage, chats, sessions }),
        requests: chatRequests(chats),
        ...chatAccess(chats, sessions),
        agentImages: { attach: (chatId, upload) => chats.attachAgentImage(chatId, upload) },
        visuals: { ...agentVisuals({ enabled: () => machine.visualReplies !== false, visuals, chats }), ...visualRender }
    };

    const dispatcher = new Dispatcher();
    if (peer) {
        const peerStores = new Map<string, BundleStore>();
        peerTasks = new PeerTasks({
            links: peer.links,
            projects: store,
            lineage,
            tasks,
            outbox,
            enqueue: (projectId, target, work) => outboxLink.enqueue(projectId, target, work),
            prompts,
            stopNode: (nodeId, reason) => endChildren.stopNode(nodeId, reason),
            installed: async () => installed,
            exists: (nodeId) => chats.get(nodeId) !== undefined || sessions.get(nodeId) !== undefined,
            git: peer.git,
            peerBundles: (machineId) => {
                const held = peerStores.get(machineId) ?? new BundleStore(home, machineId);
                peerStores.set(machineId, held);
                return held;
            },
            worktreePaths: async (folder) => (await worktrees?.registeredPaths(folder)) ?? [],
            notify: peer.notify
        });
        tasks.onChange((task) => peerTasks!.changed(task));
        registerPeerTaskHandlers(dispatcher, peer.links, peerTasks);
    }
    registerSessionHandlers(dispatcher, sessions, endChildren.owe);
    const forkDeps = chatForkDeps({
        chats,
        host,
        titleFor: (id) => store.index.titleFor(id),
        lineage,
        hiddenAgents: store.hiddenAgents,
        ...(worktrees ? { worktrees } : {}),
        ...(checkpoints instanceof Checkpoints ? { checkpoints } : {})
    });
    host.forks = { fork: (input, opener) => forkForAgent(forkDeps, input, opener) };
    registerChatHandlers(
        dispatcher,
        chats,
        providers,
        endChildren.owe,
        endChildren.stopNode,
        {
            fork: (payload) => forkChat(forkDeps, payload),
            info: (payload) => readForkInfo(forkDeps, payload),
            handoff: (payload) => readHandoff(forkDeps, payload),
            summarize: (chatId) => summaries.summarize(chatId),
            continueOn: (payload) => continueOn({ chats, fork: (fork) => forkChat(forkDeps, fork) }, payload)
        },
        undefined,
        undefined,
        undefined,
        (chatId) => lineage.peerOf(chatId) !== null && outbox.list().some((entry) => entry.kind === 'start-agent' && entry.target === chatId)
    );
    registerTaskHandlers(dispatcher, tasks, endChildren.children);
    registerPlanHandlers(dispatcher, plans);
    if (!dispatcher.has('server.ping')) {
        dispatcher.register('server.ping', () => ({ time: Date.now() }));
    }

    return {
        tasks,
        notices,
        lineage,
        outbox,
        worker,
        sessions,
        chats,
        plans,
        visuals,
        adapter,
        dispatcher,
        claude,
        codex,
        chatEnvs,
        chatCommands,
        wiring,
        endChildren,
        peerTasks,
        remoteTasks,
        prWatches,
        host,
        alerts,
        enqueued,
        request: async (type, payload) => {
            const frames: ServerFrame[] = [];
            await dispatcher.handle({ id: 'client-1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
            return frames[0]!;
        },
        pruned: async () => {
            await Promise.all(drops);
        },
        until,
        stop: async () => {
            // The order the daemon's own shutdown takes: nothing that dies with it settles a task.
            worker.stop();
            prWatches.close();
            wiring.coordinator.stop();
            wiring.waiting.stop();
            summaries.coordinator.stop();
            await wiring.coordinator.settled();
            await worker.settled();
            chats.persistAllSync();
            await chats.shutdown();
            sessions.killAll();
            for (const info of chats.list()) {
                await chats.get(info.chatId)?.dispose();
            }
        }
    };
}

/* A project saved from `content` in a fresh folder and released, as a project no window holds is. */
export async function releasedProject(
    prefix: string,
    content: ProjectContent
): Promise<{ root: string; home: string; folder: string; store: ProjectStore; projectId: string }> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    const home = join(root, 'home');
    const folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    const store = new ProjectStore(home, projectLinks());
    const opened = await store.openProject({ folder });
    const projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content);
    store.release(projectId);
    return { root, home, folder, store, projectId };
}

/* Everything in the thread of a chat, in order. */
export function itemsOf(daemon: Pick<TestDaemon, 'chats'>, chatId: string): ChatItem[] {
    return daemon.chats.get(chatId)?.thread.list() ?? [];
}

/* The turns in the thread of a chat. */
export function turnsOf(daemon: Pick<TestDaemon, 'chats'>, chatId: string): ChatTurnItem[] {
    return itemsOf(daemon, chatId).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

/* A verb the node `caller` runs, the way `ruimte-context` posts it; the token is the caller's id. */
export async function runVerb(daemon: Pick<TestDaemon, 'host'>, caller: string, name: string, argv: string[]): Promise<string[]> {
    const path = `${CANVAS_PATH}/${name}`;
    const response = await handleCanvasRequest(
        new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: `Bearer ${caller}` }, body: JSON.stringify({ argv }) }),
        path,
        { targetForToken: (token) => token, host: daemon.host }
    );
    return (await response.text()).trim().split('\n');
}
