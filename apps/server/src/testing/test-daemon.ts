import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCore, VisualStore } from '@adecore/agents/chat';
import type { AgentLineageStore, NoticeStore, OutboxWorker, TaskStore } from '@adecore/agents/coordination';
import type { ChatProvider, ProviderAccountsService } from '@adecore/agents/providers';
import type { FakeCli, InProcessCli, ManualClock } from '@adecore/agents/testing';
import type { AgentKind, ChatItem, ChatTurnItem, ProjectContent, ServerFrame } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/host.ts';
import type { PendingPromptStore } from '../canvas/pending-prompts.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { Checkpoints } from '../git/checkpoints.ts';
import type { GhRunner } from '../git/github.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { OutboxStore, OutboxWork } from '../outbox/outbox.ts';
import type { RemoteTasks, RemoteTasksDeps } from '../peer/giver/remote-tasks.ts';
import type { PeerTasks } from '../peer/worker/peer-tasks.ts';
import type { PlanStore } from '../plans/plan-store.ts';
import { projectOverlays } from '../projects/overlays.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { FakePtyAdapter } from '../pty/fake-pty.ts';
import type { PtyAdapter } from '../pty/pty.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { TaskWiring } from '../tasks/wiring.ts';
import { toolAnswer, toolCall } from '../tools/tool-test-helpers.ts';
import type { VisualHost } from '../visuals/agent-host.ts';
import { wireDaemon } from '../wire-daemon.ts';
import type { DaemonBundles } from '../wiring/bundles.ts';
import type { OutboxLink } from '../wiring/outbox.ts';
import { testRuntime, testSeams, type TestSeams } from './test-seams.ts';

/* One run of the daemon over a home, wired by `wireDaemon` with the seams of `test-seams.ts` where a process or the outside world would be. */
export interface TestDaemon {
    tasks: TaskStore;
    notices: NoticeStore;
    lineage: AgentLineageStore;
    prompts: PendingPromptStore;
    outbox: OutboxStore;
    /* What the daemon's own services owe the outbox through, as the cards' answers do. */
    link: OutboxLink;
    prWatches: PrWatchStore;
    worker: OutboxWorker<OutboxWork>;
    sessions: SessionManager;
    chats: ChatCore;
    chatManager: ChatManager;
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
    /* The tasks other machines gave. */
    peerTasks: PeerTasks;
    /* The tasks this machine gave other machines. */
    remoteTasks: RemoteTasks;
    host: CanvasHost;
    /* Every bundle the wiring made, for what a test reads that no field above names. */
    bundles: DaemonBundles;
    alerts: string[];
    /* Every piece of work owed since boot, kept after the worker took it off the outbox. */
    enqueued: OutboxWork[];
    /* A request over the wire from one client, answered by the same handlers a socket reaches. */
    request(type: string, payload: unknown): Promise<ServerFrame>;
    /* Resolves once what a deleted node took along (an unused fork's record) is gone. */
    pruned(): Promise<void>;
    /* Resolves once `check` holds, looked at again on every event and every task written. */
    until(check: () => boolean): Promise<void>;
    /* Flips switches of the machine, as a person does in its settings. */
    setSwitches(flags: { resumeAtReset?: boolean; visualReplies?: boolean }): Promise<void>;
    stop(): Promise<void>;
}

interface TestDaemonOptions {
    home: string;
    store: ProjectStore;
    clock: ManualClock;
    /* What runs a terminal; the fake adapter unless a measurement needs real processes. */
    ptyAdapter?: PtyAdapter;
    checkpoints?: Checkpoints;
    /* Real worktrees for the tools; without them a project is in no repository. */
    worktrees?: Worktrees;
    /* The CLIs this machine says it has; Claude Code alone unless a test needs another. */
    installed?: AgentKind[];
    /* What runs as Claude Code; the plain fake unless a test needs one that misbehaves. */
    claudeCli?: FakeCli;
    /* What runs as Codex; the plain fake unless a test needs another. */
    codexCli?: FakeCli;
    /* The machine's switches a test flips; resuming after a limit is off and visual replies on, as on a fresh machine. */
    machine?: { resumeAtReset: boolean; visualReplies?: boolean };
    /* The accounts of the CLIs; without them every CLI has only its default account. */
    accounts?: ProviderAccountsService;
    /* The environment every CLI starts from. */
    env?: Record<string, string | undefined>;
    /* What a running turn says about the plan of its account. */
    onLimits?: (update: Parameters<TestSeams['observers']['limits']>[0]) => void;
    /* How pages are previewed and measured; without it a preview is refused and a page shown without heights. */
    visualRender?: Pick<VisualHost, 'preview' | 'measure'>;
    /* What `gh` answers a pull request watch; without it every call fails. */
    gh?: GhRunner;
    /* The machines this one gives tasks to: which are linked, the link to each and the reconnect owed while one is away. */
    remote?: {
        machines: NonNullable<CanvasHost['remote']>['machines'];
        connections: RemoteTasksDeps['connections'];
        reconnect: RemoteTasksDeps['reconnect'];
    };
    /* How this machine, working for another, tells it that a task settled. */
    peer?: {
        notify: (machineId: string, nodeId: string) => void;
    };
    /* Providers in place of the built-ins of their kind, such as the Claude API on a service of the test's own. */
    providers?: readonly ChatProvider[];
}

export async function bootTestDaemon(options: TestDaemonOptions): Promise<TestDaemon> {
    const {
        home,
        store,
        clock,
        worktrees,
        checkpoints,
        machine = { resumeAtReset: false },
        accounts,
        onLimits,
        visualRender,
        remote,
        peer,
        providers = []
    } = options;
    const base = testSeams({
        home,
        clock,
        ...(options.installed ? { installed: options.installed } : {}),
        ...(options.claudeCli ? { claudeCli: options.claudeCli } : {}),
        ...(options.codexCli ? { codexCli: options.codexCli } : {}),
        ...(options.ptyAdapter ? { ptyAdapter: options.ptyAdapter } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.gh ? { gh: options.gh } : {})
    });
    const seams: TestSeams = {
        ...base,
        projectStore: () => store,
        providers: { ...base.providers, added: providers },
        git: {
            ...base.git,
            ...(worktrees ? { worktrees: () => worktrees } : {}),
            ...(checkpoints ? { checkpoints: () => checkpoints } : {})
        },
        observers: { ...base.observers, ...(onLimits ? { limits: onLimits } : {}) },
        ...(accounts ? { accounts: () => accounts } : {}),
        ...(remote ? { remote: { connections: () => remote.connections, reconnect: () => remote.reconnect } } : {}),
        ...(peer ? { peerNotify: () => peer.notify } : {})
    };
    const wired = await wireDaemon({ runtime: testRuntime(home), launcher: 'standalone', seams, shutdown: async () => undefined });
    const { stores, agents, work, canvasHost: host, machine: machineBundle } = wired.bundles;
    const { sessions, chats, chatManager } = agents;
    const { fakes } = seams;

    // Written down by `setSwitches`, so a second boot over the same home starts from what a fresh machine has, as the test says.
    await machineBundle.identity.setSwitches({ resumeAtReset: machine.resumeAtReset, visualReplies: machine.visualReplies ?? true });

    // Preview and measure come from the test or are absent, as on a host with no browser.
    const { preview: _preview, measure: _measure, ...visualsWithoutRender } = host.visuals!;
    host.visuals = { ...visualsWithoutRender, ...visualRender };

    if (remote) {
        host.remote = { ...host.remote!, machines: remote.machines };
    }

    // The start production runs, with no socket to serve: the outbox and every clock of the daemon start here, as in the app.
    await wired.start({ port: 0, requestStop: () => undefined, serve: () => undefined });
    sessions.observe(fakes.recheck);
    chats.observe(fakes.recheck);
    // A task is written after the event that settled it, so the wait looks again once it is on disk.
    stores.tasks.onChange(() => queueMicrotask(fakes.recheck));

    return {
        tasks: stores.tasks,
        notices: stores.notices,
        lineage: stores.lineage,
        prompts: stores.prompts,
        outbox: stores.outbox,
        link: agents.outboxLink,
        worker: work.worker,
        sessions,
        chats,
        chatManager,
        plans: agents.plans,
        visuals: agents.visuals,
        adapter: fakes.adapter,
        dispatcher: wired.dispatcher,
        claude: fakes.claude,
        codex: fakes.codex,
        chatEnvs: fakes.chatEnvs,
        chatCommands: fakes.chatCommands,
        wiring: work.tasks,
        endChildren: work.endChildren,
        peerTasks: work.peerTasks,
        remoteTasks: work.remoteTasks,
        prWatches: work.prWatches,
        host,
        bundles: wired.bundles,
        alerts: fakes.alerts,
        enqueued: fakes.enqueued,
        request: async (type, payload) => {
            const frames: ServerFrame[] = [];
            await wired.dispatcher.handle({ id: 'client-1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
            return frames[0]!;
        },
        pruned: async () => {
            await Promise.all(fakes.drops);
        },
        until: fakes.until,
        setSwitches: (flags) => machineBundle.identity.setSwitches(flags),
        stop: async () => {
            await wired.stop();
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
    const store = new ProjectStore(home, projectLinks(), projectOverlays(home));
    const opened = await store.openProject({ folder });
    const projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content);
    store.release(projectId);
    return { root, home, folder, store, projectId };
}

export function itemsOf(daemon: Pick<TestDaemon, 'chats'>, chatId: string): ChatItem[] {
    return daemon.chats.get(chatId)?.thread.list() ?? [];
}

export function turnsOf(daemon: Pick<TestDaemon, 'chats'>, chatId: string): ChatTurnItem[] {
    return itemsOf(daemon, chatId).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

/* A tool of a toolkit the node `caller` calls with JSON input: its lines, or a refusal as its `refused` rows. */
export async function invokeTool(daemon: Pick<TestDaemon, 'host'>, caller: string, name: string, input: Record<string, unknown>): Promise<string[]> {
    return (await toolAnswer(name, input, toolCall(caller, daemon.host))).lines;
}
