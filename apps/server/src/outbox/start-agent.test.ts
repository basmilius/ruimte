import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ProjectContent } from '@ruimte/contracts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { AgentStart, CanvasHost } from '../canvas/verb.ts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { fakeCodex } from '../chat/fake-codex.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager } from '../sessions/manager.ts';
import { OutboxStore, type StartAgentEntry } from './outbox.ts';
import { OutboxWorker, type OutboxClock } from './outbox-worker.ts';
import { HEADLESS_TERMINAL, nodeMode, startAgentHandler, startAgentWork, type StartAgentDeps } from './start-agent.ts';

/* Nothing here fails, so no retry is ever timed; the clock only has to say one moment. */
const stillClock: OutboxClock = { now: () => 1, setTimeout: () => null, clearTimeout: () => undefined };

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const TEAM = [
    { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude' },
    { title: 'Parser', prompt: 'fix the parser', provider: 'codex', chat: true },
    { title: 'Docs', prompt: 'write the docs', provider: 'claude', chat: true }
];

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

/* One run of the daemon over a home: the stores read from disk, the managers empty, nothing kept from a run before. */
interface Daemon {
    prompts: PendingPromptStore;
    outbox: OutboxStore;
    worker: OutboxWorker;
    sessions: SessionManager;
    chats: ChatManager;
    adapter: FakePtyAdapter;
    claude: InProcessCli;
    codex: InProcessCli;
    host: CanvasHost;
    /* Resolves once `check` holds, looked at again on every event either manager sends out. */
    until(check: () => boolean): Promise<void>;
    retire(): Promise<void>;
}

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let running: Daemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-start-agent-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    // Released: the view is open in no window, which is the case the daemon has to start agents for.
    store.release(projectId);
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.retire();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const boot = async (): Promise<Daemon> => {
    const prompts = new PendingPromptStore(home);
    await prompts.load();
    const lineage = new AgentLineageStore(home);
    await lineage.load();
    const outbox = new OutboxStore(home);
    await outbox.load();
    const adapter = new FakePtyAdapter();
    const claude = inProcess(fakeClaude);
    const codex = inProcess(fakeCodex);
    const sessions = new SessionManager({ adapter, env: { HOME: home, PATH: process.env.PATH }, firstPrompt: (id) => prompts.take(id) });
    const attachments = new AttachmentStore(home);
    const chats = new ChatManager({
        providers,
        store: new ChatStore(home, attachments),
        attachments,
        spawn: (options) => (options.command[0] === 'codex' ? codex.spawn(options) : claude.spawn(options)),
        env: { PATH: process.env.PATH, HOME: home },
        firstPrompt: (id) => prompts.take(id)
    });
    const worker = new OutboxWorker({
        store: outbox,
        clock: stillClock,
        handlers: {
            'resume-run': () => Promise.reject(new Error('no resume in these tests')),
            'wake-parent': () => Promise.reject(new Error('no wake in these tests')),
            'end-children': () => Promise.reject(new Error('no ending in these tests')),
            'start-agent': startAgentHandler({
                placed: (nodeId) => store.index.locate(nodeId) !== null,
                hasChat: (chatId) => chats.get(chatId) !== undefined,
                createChat: (payload) => chats.create(payload),
                composerPreference: (provider) => chats.composerPreferences.for(provider),
                killChat: (chatId) => chats.kill(chatId),
                hasSession: (sessionId) => sessions.get(sessionId) !== undefined,
                createSession: (options) => sessions.create(options),
                killSession: (sessionId) => sessions.kill(sessionId)
            })
        }
    });
    store.index.onPlaces = (id, ids) => {
        void prompts.prune(id, ids);
        void outbox.prune(id, ids);
    };

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
    sessions.observe(recheck);
    chats.observe(recheck);

    const unused = (): never => {
        throw new Error('not used by agent and team');
    };
    const modes = {
        chatMode: (id: string) => chats.get(id)?.info.runtimeMode,
        launch: (id: string) => sessions.get(id)?.launch,
        reportedMode: (id: string) => sessions.get(id)?.reportedMode
    };
    const host: CanvasHost = {
        locate: (id) => store.index.locate(id),
        read: (id) => store.read(id),
        mutate: (id, apply) => store.mutate(id, apply),
        worktreePaths: async () => [],
        installedAgents: async () => ['claude', 'codex'],
        holdPrompt: (id, nodeId, prompt) => prompts.put(id, nodeId, prompt),
        startAgent: (start: AgentStart) => worker.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: async () => null,
        addWorktree: () => Promise.reject(new Error('not used here')),
        removeWorktree: async () => undefined,
        claimWorktree: async () => undefined,
        depthOf: (nodeId) => lineage.depthOf(nodeId),
        openedCount: (callerId) => lineage.openedCount(callerId),
        recordMade: (record) => lineage.put(record),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => false,
        showView: () => false,
        endSession: unused,
        notify: unused,
        writeDiagram: unused,
        tasks: { open: unused, done: unused, involving: () => [] }
    };

    const daemon: Daemon = {
        prompts,
        outbox,
        worker,
        sessions,
        chats,
        adapter,
        claude,
        codex,
        host,
        until: (check) =>
            check()
                ? Promise.resolve()
                : new Promise((resolve) => {
                      waiters.push({ check, resolve });
                  }),
        retire: async () => {
            worker.stop();
            sessions.killAll();
            await chats.shutdown();
            for (const info of chats.list()) {
                chats.get(info.chatId)?.dispose();
            }
        }
    };
    running.push(daemon);
    return daemon;
};

/* A team verb run by the lead chat, the way `ruimte-context team` posts it. */
const openTeam = async (daemon: Daemon): Promise<string[]> => {
    const path = `${CANVAS_PATH}/team`;
    const response = await handleCanvasRequest(
        new Request(`http://127.0.0.1${path}`, {
            method: 'POST',
            headers: { authorization: 'Bearer lead' },
            body: JSON.stringify({ argv: ['--label', 'Crew', '--roles', JSON.stringify(TEAM)] })
        }),
        path,
        { targetForToken: (token) => (token === 'lead' ? 'chat-lead' : null), host: daemon.host }
    );
    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split('\n');
    return lines.slice(1).map((line) => line.split('\t')[0]!);
};

const userTexts = (items: readonly ChatItem[]): string[] => items.flatMap((item) => (item.kind === 'user' ? [item.text] : []));

const firstTurnDone = (daemon: Daemon, chatId: string) => (): boolean => {
    const info = daemon.chats.get(chatId)?.info;
    return info !== undefined && info.usage.turns === 1 && info.activeTurnId === null;
};

const hook = (event: string) => ({ session_id: 'claude-lexer', hook_event_name: event });

describe('a team the daemon starts on its own', () => {
    test('all three agents run their first turn with the view open in no window, and a client that mounts later joins them', async () => {
        const daemon = await boot();
        // The lead chat runs supervised, which is the mode a chat it opens inherits.
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        daemon.worker.start();

        const [lexer, parser, docs] = await openTeam(daemon);
        await daemon.worker.settled();

        // Nobody is subscribed to either manager: no socket, no client, no mount.
        expect(daemon.sessions.wantsApprovals()).toBe(false);

        // The terminal agent started at the headless size with its prompt on its launch line.
        const pty = daemon.adapter.forSession(lexer!);
        expect([pty.options.cols, pty.options.rows]).toEqual([HEADLESS_TERMINAL.cols, HEADLESS_TERMINAL.rows]);
        expect(pty.options.cwd).toBe(folder);
        expect(pty.input).toHaveLength(1);
        expect(pty.input[0]).toContain("'fix the tokenizer'");
        // Its CLI reports its turn through the hooks, the only way a terminal agent says anything.
        const token = daemon.sessions.get(lexer!)!.hookToken;
        expect(await daemon.sessions.applyHook('claude', token, hook('UserPromptSubmit'))).toBe('applied');
        expect(await daemon.sessions.applyHook('claude', token, hook('Stop'))).toBe('applied');
        expect(daemon.sessions.get(lexer!)!.agent?.status).toBe('idle');

        await daemon.until(firstTurnDone(daemon, parser!));
        await daemon.until(firstTurnDone(daemon, docs!));
        expect(daemon.chats.get(docs!)!.info.runtimeMode).toBe('supervised');
        expect(daemon.chats.get(parser!)!.info.cwd).toBe(folder);

        expect(daemon.outbox.list()).toEqual([]);
        expect(await readdir(join(home, 'prompts')).catch(() => [])).toEqual([]);

        // A client opens the view: its mounts attach to what runs and deliver no second prompt.
        expect((await daemon.chats.create({ chatId: docs!, provider: 'claude', cwd: folder })).usage.turns).toBe(1);
        expect(userTexts(daemon.chats.attach(docs!, 'client-1').items)).toEqual(['write the docs']);
        expect(userTexts(daemon.chats.attach(parser!, 'client-1').items)).toEqual(['fix the parser']);
        expect(daemon.claude.started).toHaveLength(1);
        expect(daemon.codex.started).toHaveLength(1);

        await expect(daemon.sessions.create({ sessionId: lexer!, cols: 80, rows: 24, cwd: folder, agent: { kind: 'claude' } })).rejects.toMatchObject({
            code: 'session-exists'
        });
        await daemon.sessions.attach(lexer!, 'client-1', 80, 24);
        expect(pty.resizes).toContainEqual({ cols: 80, rows: 24 });
        expect(daemon.adapter.spawned).toHaveLength(1);
        expect(pty.input).toHaveLength(1);
    });

    test('a daemon that restarts between the write and the start starts every agent exactly once', async () => {
        const before = await boot();
        // The worker never got going: the daemon went down right after the verb wrote the team.
        const ids = await openTeam(before);
        await before.retire();
        expect(before.adapter.spawned).toEqual([]);
        expect(before.chats.list()).toEqual([]);

        const after = await boot();
        after.worker.start();
        await after.worker.settled();
        expect(after.adapter.spawned.map((pty) => pty.options.env.RUIMTE_SESSION_ID)).toEqual([ids[0]]);
        await after.until(firstTurnDone(after, ids[1]!));
        await after.until(firstTurnDone(after, ids[2]!));
        await after.retire();

        const again = await boot();
        again.worker.start();
        await again.worker.settled();
        expect(again.adapter.spawned).toEqual([]);
        expect(again.chats.list()).toEqual([]);
        expect(again.claude.started).toEqual([]);
    });

    test('a node deleted before its start is never started, and what was owed for it goes', async () => {
        const daemon = await boot();
        const [lexer, parser, docs] = await openTeam(daemon);
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== parser) } : view))
            },
            result: null
        }));
        daemon.worker.start();
        await daemon.worker.settled();

        expect(daemon.adapter.spawned.map((pty) => pty.options.env.RUIMTE_SESSION_ID)).toEqual([lexer]);
        expect(daemon.chats.get(parser!)).toBeUndefined();
        await daemon.until(firstTurnDone(daemon, docs!));
        expect(daemon.codex.started).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });
});

describe('the start of one agent node', () => {
    const entry = (node: 'chat' | 'terminal'): StartAgentEntry => ({
        kind: 'start-agent',
        id: `start-agent-${node}`,
        projectId: 'project',
        target: `${node}-1`,
        createdAt: 1,
        attempts: 0,
        notBefore: 1,
        payload: { node, provider: 'claude', cwd: '/work', runtimeMode: 'supervised' }
    });

    const fakeDeps = (overrides: Partial<StartAgentDeps> = {}) => {
        const calls: string[] = [];
        const deps: StartAgentDeps = {
            placed: () => true,
            hasChat: () => false,
            createChat: async (payload) => {
                calls.push(`create chat ${JSON.stringify(payload)}`);
            },
            composerPreference: () => ({}),
            killChat: async (chatId) => {
                calls.push(`kill chat ${chatId}`);
            },
            hasSession: () => false,
            createSession: async (options) => {
                calls.push(`create session ${JSON.stringify(options)}`);
            },
            killSession: async (sessionId) => {
                calls.push(`kill session ${sessionId}`);
            },
            log: (line) => calls.push(`log ${line}`),
            ...overrides
        };
        return { calls, deps };
    };

    test('a chat takes the mode it was given, a terminal starts the way a client would start the node', async () => {
        const { calls, deps } = fakeDeps();
        await startAgentHandler(deps)(entry('chat'));
        await startAgentHandler(deps)(entry('terminal'));
        expect(calls).toEqual([
            'create chat {"chatId":"chat-1","provider":"claude","cwd":"/work","runtimeMode":"supervised"}',
            'create session {"sessionId":"terminal-1","cols":120,"rows":40,"cwd":"/work","agent":{"kind":"claude","runtimeMode":"supervised"}}'
        ]);
    });

    test('nothing a chat starts with is wider than the node that opened it, the composer preference included', async () => {
        const { calls, deps } = fakeDeps({ composerPreference: () => ({ runtimeMode: 'full-access' }) });
        const opened = entry('chat');
        // Opened by a terminal agent in auto-accept-edits: the person's full access is narrowed to it.
        await startAgentHandler(deps)({ ...opened, payload: { node: 'chat', provider: 'claude', cwd: '/work', ceiling: 'auto-accept-edits' } });
        // With no preference at all the default, full access, is narrowed the same way.
        const bare = fakeDeps();
        await startAgentHandler(bare.deps)({ ...opened, payload: { node: 'chat', provider: 'claude', cwd: '/work', ceiling: 'supervised' } });
        // A terminal entry that somehow asks for more than its opener has is narrowed as well.
        await startAgentHandler(bare.deps)({
            ...entry('terminal'),
            payload: { node: 'terminal', provider: 'claude', cwd: '/work', runtimeMode: 'full-access', ceiling: 'auto' }
        });
        expect([...calls, ...bare.calls]).toEqual([
            'create chat {"chatId":"chat-1","provider":"claude","cwd":"/work","runtimeMode":"auto-accept-edits"}',
            'create chat {"chatId":"chat-1","provider":"claude","cwd":"/work","runtimeMode":"supervised"}',
            'create session {"sessionId":"terminal-1","cols":120,"rows":40,"cwd":"/work","agent":{"kind":"claude","runtimeMode":"auto"}}'
        ]);
    });

    test('the entry a verb owes carries the opener as the ceiling, a chat its mode and a terminal what it runs', () => {
        const modes = {
            chatMode: (id: string) => (id === 'lead' ? ('auto' as const) : undefined),
            launch: (id: string) =>
                id === 'shell' || id === 'switched'
                    ? { kind: 'claude' as const, runtimeMode: 'auto-accept-edits' as const }
                    : id === 'plain'
                      ? null
                      : undefined,
            reportedMode: (id: string) => (id === 'switched' ? ('supervised' as const) : null)
        };
        const start = { projectId: 'p', nodeId: 'n', node: 'chat' as const, provider: 'claude' as const, cwd: null };
        expect(startAgentWork({ ...start, openedBy: 'lead' }, modes).payload).toEqual({
            node: 'chat',
            provider: 'claude',
            cwd: null,
            runtimeMode: 'auto',
            ceiling: 'auto'
        });
        expect(startAgentWork({ ...start, openedBy: 'shell' }, modes).payload).toEqual({
            node: 'chat',
            provider: 'claude',
            cwd: null,
            ceiling: 'auto-accept-edits'
        });
        // A CLI typed into a plain shell, or a node the daemon runs nothing for, counts as the strictest.
        expect(nodeMode(modes)('plain')).toBe('supervised');
        expect(nodeMode(modes)('nobody')).toBe('supervised');
        const unreported = { chatMode: () => undefined, reportedMode: () => undefined };
        expect(nodeMode({ ...unreported, launch: () => ({ kind: 'codex' }) })('x')).toBe('full-access');
        expect(nodeMode({ ...unreported, launch: () => ({ kind: 'codex', resume: 'abc' }) })('x')).toBe('supervised');
        // What the hooks reported outranks the launch, since a person can switch modes inside the CLI.
        expect(nodeMode(modes)('switched')).toBe('supervised');
        expect(nodeMode({ chatMode: () => undefined, launch: () => null, reportedMode: () => 'full-access' })('x')).toBe('full-access');
    });

    test('a chat takes the model and mode of the composer preference, and the mode of the chat that opened it beats it', async () => {
        const opus = { model: 'claude-opus-5', options: { effort: 'high' } };
        const { calls, deps } = fakeDeps({ composerPreference: () => ({ runtimeMode: 'auto', selection: opus }) });
        await startAgentHandler(deps)(entry('chat'));
        const unopened = entry('chat');
        await startAgentHandler(deps)({ ...unopened, payload: { node: 'chat', provider: 'claude', cwd: '/work' } });
        expect(calls).toEqual([
            `create chat {"chatId":"chat-1","provider":"claude","cwd":"/work","selection":${JSON.stringify(opus)},"runtimeMode":"supervised"}`,
            `create chat {"chatId":"chat-1","provider":"claude","cwd":"/work","selection":${JSON.stringify(opus)},"runtimeMode":"auto"}`
        ]);
    });

    test('what already runs is left alone, and so is a node that is gone', async () => {
        const { calls, deps } = fakeDeps({ hasChat: () => true, hasSession: () => true });
        await startAgentHandler(deps)(entry('chat'));
        await startAgentHandler(deps)(entry('terminal'));
        const gone = fakeDeps({ placed: () => false });
        await startAgentHandler(gone.deps)(entry('chat'));
        expect([...calls, ...gone.calls]).toEqual([]);
    });

    test('a node deleted while its session was being made has that session ended', async () => {
        let placed = true;
        const { calls, deps } = fakeDeps({
            placed: () => placed,
            createSession: async () => {
                // The delete lands while the create is still on its way.
                placed = false;
            }
        });
        await startAgentHandler(deps)(entry('terminal'));
        expect(calls).toEqual(['kill session terminal-1']);
    });

    test('a client that made the session first is no failure, and a real failure is logged without a throw', async () => {
        const exists = fakeDeps({
            createSession: async () => {
                throw Object.assign(new Error('Session terminal-1 already exists'), { code: 'session-exists' });
            }
        });
        await startAgentHandler(exists.deps)(entry('terminal'));
        expect(exists.calls).toEqual([]);

        const broken = fakeDeps({
            createChat: async () => {
                throw new Error('spawn failed');
            }
        });
        await startAgentHandler(broken.deps)(entry('chat'));
        expect(broken.calls).toEqual(['log Starting the agent of chat-1 failed: spawn failed']);
    });
});
