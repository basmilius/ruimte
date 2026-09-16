import type { ServerFrame } from '@ruimte/contracts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { AgentStart, CanvasHost } from '../canvas/verb.ts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { Dispatcher } from '../dispatcher.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { Worktrees } from '../git/worktrees.ts';
import { registerChatHandlers } from '../handlers/chat.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { registerTaskHandlers } from '../handlers/tasks.ts';
import { wireEndChildren, type EndChildrenWiring } from '../outbox/end-children.ts';
import type { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker } from '../outbox/outbox-worker.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from '../outbox/resume-run.ts';
import { nodeMode, startAgentHandler, startAgentWork } from '../outbox/start-agent.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager } from '../sessions/manager.ts';
import { TaskStore } from './task-store.ts';
import { wireTasks, type TaskWiring } from './wiring.ts';

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

/* One run of the daemon over a home, wired the way `daemon.ts` wires it, with fakes where a process would be. */
export interface TestDaemon {
    tasks: TaskStore;
    lineage: AgentLineageStore;
    outbox: OutboxStore;
    worker: OutboxWorker;
    sessions: SessionManager;
    chats: ChatManager;
    adapter: FakePtyAdapter;
    claude: InProcessCli;
    wiring: TaskWiring;
    endChildren: EndChildrenWiring;
    host: CanvasHost;
    alerts: string[];
    /* A request over the wire from one client, answered by the same handlers a socket reaches. */
    request(type: string, payload: unknown): Promise<ServerFrame>;
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
}

export const bootTestDaemon = async ({ home, store, clock, checkpoints, worktrees }: TestDaemonOptions): Promise<TestDaemon> => {
    const prompts = new PendingPromptStore(home);
    await prompts.load();
    const lineage = new AgentLineageStore(home);
    await lineage.load();
    const outbox = new OutboxStore(home);
    await outbox.load();
    const tasks = new TaskStore(home);
    await tasks.load();
    const adapter = new FakePtyAdapter();
    const claude = inProcess(fakeClaude);
    const sessions = new SessionManager({ adapter, env: { HOME: home, PATH: process.env.PATH }, firstPrompt: (id) => prompts.take(id) });
    const attachments = new AttachmentStore(home);
    const box: { worker: OutboxWorker | null } = { worker: null };
    const chats = new ChatManager({
        providers,
        store: new ChatStore(home, attachments),
        attachments,
        ...(checkpoints ? { checkpoints } : {}),
        spawn: (options) => claude.spawn(options),
        env: { PATH: process.env.PATH, HOME: home },
        firstPrompt: (id) => prompts.take(id),
        onInterruptedRun: oweResume({
            projectOf: (chatId) => store.index.locate(chatId)?.projectId ?? null,
            entries: () => outbox.list(),
            enqueue: (id, target, work) => box.worker!.enqueue(id, target, work)
        }),
        taskRows: (chatId) => tasks.ofParent(chatId),
        endedAt: (chatId) => lineage.endedAt(chatId)
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
    const wiring = wireTasks({
        tasks,
        chats,
        placed: (nodeId) => store.index.locate(nodeId) !== null,
        titleFor: (nodeId) => store.index.titleFor(nodeId),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        // Owed after the task is written, so a wait on the outbox looks again once the entry is there.
        enqueue: async (id, target, work) => {
            await box.worker!.enqueue(id, target, work);
            recheck();
        },
        alert: (_target, nodeId, title, body) => alerts.push(`${nodeId}\t${title}\t${body}`),
        wake: (chatId) => box.worker!.wake(chatId),
        now: () => clock.now()
    });
    const endChildren = wireEndChildren({
        lineage,
        outbox,
        tasks,
        chats,
        sessions,
        enqueue: async (id, target, work) => {
            await box.worker!.enqueue(id, target, work);
            recheck();
        },
        now: () => clock.now(),
        log: () => undefined
    });
    endChildren.start();
    const worker = new OutboxWorker({
        store: outbox,
        clock,
        handlers: {
            'start-agent': startAgentHandler({
                placed: (nodeId) => store.index.locate(nodeId) !== null,
                hasChat: (chatId) => chats.get(chatId) !== undefined,
                createChat: (payload) => chats.create(payload),
                composerPreference: (provider) => chats.composerPreferences.for(provider),
                killChat: (chatId) => chats.kill(chatId),
                hasSession: (sessionId) => sessions.get(sessionId) !== undefined,
                createSession: (options) => sessions.create(options),
                killSession: (sessionId) => sessions.kill(sessionId),
                onGaveUp: wiring.onStartGaveUp,
                log: () => undefined
            }),
            'resume-run': resumeRunHandler(chats),
            'wake-parent': wiring.wakeParent,
            'end-children': endChildren.handler
        },
        onParked: (entry, error) => {
            resumeRunParked(chats)(entry, error);
            wiring.onParked(entry, error);
        }
    });
    box.worker = worker;
    sessions.onProcessChange = (sessionId, phase) => {
        if (phase === 'changed' && sessions.get(sessionId)?.exited !== false) {
            wiring.coordinator.terminalEnded(sessionId);
        }
    };
    sessions.observe((event) => wiring.coordinator.sessionEvent(event));
    store.index.onPlaces = (id, ids) => {
        endChildren.places(id, ids);
        void prompts.prune(id, ids);
        void lineage.prune(id, ids);
        void outbox.prune(id, ids);
        void wiring.prune(id, ids);
    };

    sessions.observe(recheck);
    chats.observe(recheck);
    // A task is written after the event that settled it, so the wait looks again once it is on disk.
    tasks.onChange(() => queueMicrotask(recheck));

    const modes = { chatMode: (id: string) => chats.get(id)?.info.runtimeMode, launch: (id: string) => sessions.get(id)?.launch };
    const host: CanvasHost = {
        locate: (id) => store.index.locate(id),
        read: (id) => store.read(id),
        mutate: (id, apply) => store.mutate(id, apply),
        worktreePaths: async (folder) => (worktrees ? (await worktrees.list(folder).catch(() => [])).map((worktree) => worktree.path) : []),
        installedAgents: async () => ['claude'],
        holdPrompt: (id, nodeId, prompt) => prompts.put(id, nodeId, prompt),
        startAgent: (start: AgentStart) => worker.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: async (folder) => (worktrees ? worktrees.branches(folder).catch(() => null) : null),
        addWorktree: (folder, branch) => (worktrees ? worktrees.add(folder, branch) : Promise.reject(new Error('no worktrees here'))),
        removeWorktree: async (folder, path) => worktrees?.remove(folder, path),
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
        notify: () => Promise.reject(new Error('not used here')),
        writeDiagram: () => Promise.reject(new Error('not used here')),
        tasks: wiring.host
    };

    const dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, sessions, endChildren.owe);
    registerChatHandlers(dispatcher, chats, providers, endChildren.owe, endChildren.stopNode);
    registerTaskHandlers(dispatcher, tasks, endChildren.children);

    return {
        tasks,
        lineage,
        outbox,
        worker,
        sessions,
        chats,
        adapter,
        claude,
        wiring,
        endChildren,
        host,
        alerts,
        request: async (type, payload) => {
            const frames: ServerFrame[] = [];
            await dispatcher.handle({ id: 'client-1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
            return frames[0]!;
        },
        until: (check) => (check() ? Promise.resolve() : new Promise((resolve) => waiters.push({ check, resolve }))),
        stop: async () => {
            // The order the daemon's own shutdown takes: nothing that dies with it settles a task.
            worker.stop();
            wiring.coordinator.stop();
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
