import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ChatSubagentItem, ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { AgentStart, CanvasHost } from '../canvas/verb.ts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker } from '../outbox/outbox-worker.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from '../outbox/resume-run.ts';
import { startAgentHandler } from '../outbox/start-agent.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager } from '../sessions/manager.ts';
import { TaskStore } from './task-store.ts';
import { wireTasks, type TaskWiring } from './wiring.ts';

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                { id: 'term-lead', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

/* One run of the daemon over a home, wired the way `daemon.ts` wires it, with fakes where a process would be. */
interface Daemon {
    tasks: TaskStore;
    outbox: OutboxStore;
    worker: OutboxWorker;
    sessions: SessionManager;
    chats: ChatManager;
    adapter: FakePtyAdapter;
    claude: InProcessCli;
    wiring: TaskWiring;
    host: CanvasHost;
    alerts: string[];
    /* Resolves once `check` holds, looked at again on every event and every task written. */
    until(check: () => boolean): Promise<void>;
    stop(): Promise<void>;
}

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let clock: ManualClock;
let running: Daemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-tasks-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    clock = new ManualClock();
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
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
        spawn: (options) => claude.spawn(options),
        env: { PATH: process.env.PATH, HOME: home },
        firstPrompt: (id) => prompts.take(id),
        onInterruptedRun: oweResume({
            projectOf: (chatId) => store.index.locate(chatId)?.projectId ?? null,
            entries: () => outbox.list(),
            enqueue: (id, target, work) => box.worker!.enqueue(id, target, work)
        }),
        taskRows: (chatId) => tasks.ofParent(chatId)
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
            'wake-parent': wiring.wakeParent
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
        void prompts.prune(id, ids);
        void lineage.prune(id, ids);
        void outbox.prune(id, ids);
        void wiring.prune(id, ids);
    };

    sessions.observe(recheck);
    chats.observe(recheck);
    // A task is written after the event that settled it, so the wait looks again once it is on disk.
    tasks.onChange(() => queueMicrotask(recheck));

    const host: CanvasHost = {
        locate: (id) => store.index.locate(id),
        read: (id) => store.read(id),
        mutate: (id, apply) => store.mutate(id, apply),
        worktreePaths: async () => [],
        installedAgents: async () => ['claude'],
        holdPrompt: (id, nodeId, prompt) => prompts.put(id, nodeId, prompt),
        startAgent: ({ projectId: id, nodeId, node, provider, cwd }: AgentStart) =>
            worker.enqueue(id, nodeId, { kind: 'start-agent', payload: { node, provider, cwd } }),
        depthOf: (nodeId) => lineage.depthOf(nodeId),
        openedCount: (callerId) => lineage.openedCount(callerId),
        recordMade: (record) => lineage.put(record),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => false,
        showView: () => false,
        endSession: async () => undefined,
        notify: () => Promise.reject(new Error('not used here')),
        writeDiagram: () => Promise.reject(new Error('not used here')),
        tasks: wiring.host
    };

    const daemon: Daemon = {
        tasks,
        outbox,
        worker,
        sessions,
        chats,
        adapter,
        claude,
        wiring,
        host,
        alerts,
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
    running.push(daemon);
    return daemon;
};

/* A verb the node `caller` runs, the way `ruimte-context` posts it. */
const verb = async (daemon: Daemon, caller: string, name: string, argv: string[]): Promise<string[]> => {
    const path = `${CANVAS_PATH}/${name}`;
    const response = await handleCanvasRequest(
        new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: `Bearer ${caller}` }, body: JSON.stringify({ argv }) }),
        path,
        { targetForToken: (token) => token, host: daemon.host }
    );
    return (await response.text()).trim().split('\n');
};

/* Opens a child with a task and answers its id and the id of the task. */
const delegate = async (daemon: Daemon, title: string, prompt: string, chat = true): Promise<{ childId: string; taskId: string }> => {
    const [line] = await verb(daemon, 'chat-lead', 'agent', ['claude', ...(chat ? ['--chat'] : []), '--task', title, '--prompt', prompt]);
    const fields = line!.split('\t');
    expect(fields).toHaveLength(6);
    return { childId: fields[0]!, taskId: fields[5]! };
};

const turnsOf = (daemon: Daemon, chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

const wakeTurns = (daemon: Daemon): ChatTurnItem[] => turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined);

const leadItems = (daemon: Daemon): ChatItem[] => daemon.chats.get('chat-lead')?.thread.list() ?? [];

/* The lead in the middle of a turn, as it is while it runs the verbs. */
const leadWorking = async (daemon: Daemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'slow');
    await daemon.until(() => daemon.chats.get('chat-lead')?.info.agentSessionId !== null);
};

/* Settled and owed: the wake entries are in the outbox, which is where a restart finds them. */
const settledTasks = (daemon: Daemon, count: number) => (): boolean =>
    daemon.tasks.ofParent('chat-lead').filter((task) => task.status !== 'open').length === count &&
    daemon.outbox.list().filter((entry) => entry.kind === 'wake-parent').length === count;

describe('a task wakes the chat that gave it', () => {
    test('three children that settle while the lead works give it exactly one new turn with three results, without polling', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);

        const children = [
            await delegate(daemon, 'Lexer', 'fix the tokenizer'),
            await delegate(daemon, 'Parser', 'fix the parser'),
            await delegate(daemon, 'Docs', 'write the docs')
        ];
        await daemon.until(settledTasks(daemon, 3));
        await daemon.worker.settled();

        // Settled, owed, and waiting for the lead's turn rather than being tried on a clock.
        expect(daemon.tasks.ofParent('chat-lead').map((task) => [task.status, task.wake, task.result?.source])).toEqual([
            ['done', 'pending', 'turn'],
            ['done', 'pending', 'turn'],
            ['done', 'pending', 'turn']
        ]);
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['wake-parent', 'wake-parent', 'wake-parent']);
        expect(wakeTurns(daemon)).toEqual([]);

        // The lead ends its turn.
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        const [wake] = wakeTurns(daemon);
        expect(wakeTurns(daemon)).toHaveLength(1);
        expect(wake).toMatchObject({ origin: 'agent', label: 'Lexer, Parser, Docs', taskIds: children.map((child) => child.taskId) });
        const items = leadItems(daemon);
        // No message of a person was made up: a note says what woke it, and the CLI alone got the results.
        expect(items.filter((item) => item.kind === 'user')).toHaveLength(1);
        expect(items.find((item) => item.kind === 'note' && item.turnId === wake!.id)).toMatchObject({ text: 'Woken by 3 finished tasks' });
        const answer = items.find((item) => item.kind === 'assistant' && item.turnId === wake!.id);
        expect(answer?.kind === 'assistant' ? answer.text : '').toStartWith('echo: 3 tasks you gave have settled. Their results:');
        for (const child of children) {
            expect(answer?.kind === 'assistant' ? answer.text : '').toContain(`(node ${child.childId}, task ${child.taskId}): done`);
            expect(answer?.kind === 'assistant' ? answer.text : '').toContain('echo: fix the');
        }
        expect(daemon.tasks.ofParent('chat-lead').map((task) => task.wake)).toEqual(['sent', 'sent', 'sent']);
        expect(daemon.outbox.list()).toEqual([]);

        // Every child stands in the lead's thread as a sub-agent row a panel can open.
        const rows = items.filter((item): item is ChatSubagentItem => item.kind === 'subagent');
        expect(rows.map((row) => [row.origin, row.childId, row.status, row.description])).toEqual(
            children.map((child, index) => ['ruimte', child.childId, 'done', ['Lexer', 'Parser', 'Docs'][index]])
        );
        const page = await daemon.chats.subagent('client-1', { chatId: 'chat-lead', toolUseId: rows[0]!.toolUseId });
        expect(page.items.some((item) => item.kind === 'assistant' && item.text.startsWith('echo: fix the tokenizer'))).toBe(true);
        expect(page.live).toBe(false);

        // What `tasks` shows the lead.
        expect((await verb(daemon, 'chat-lead', 'tasks', [])).map((line) => line.split('\t').slice(0, 4).join('\t'))).toEqual(
            children.map((child) => `task\t${child.taskId}\tgave\tdone`)
        );
    });

    test('a child that settles while the lead is idle wakes it at once', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer');
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([[child.taskId]]);
    });

    test('a terminal child that exits without done fails its task, and the lead is woken with that', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer', false);
        await daemon.worker.settled();
        const pty = daemon.adapter.forSession(child.childId);
        // The terminal was told how to report back, on the line its CLI starts with.
        expect(pty.input[0]).toContain('ruimte-context done --result');

        pty.exit(0);
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));

        expect(daemon.tasks.get(child.taskId)).toMatchObject({
            status: 'failed',
            wake: 'sent',
            result: { source: 'exit', text: 'It ended without a result: a terminal reports back with ruimte-context done.' }
        });
        expect(daemon.alerts).toEqual([`${child.childId}\tTask failed: Lexer\tIt ended without a result: a terminal reports back with ruimte-context done.`]);
        const row = leadItems(daemon).find((item): item is ChatSubagentItem => item.kind === 'subagent');
        expect(row?.status).toBe('failed');
    });

    test('a terminal child that calls done settles its task with that result, and its exit afterwards changes nothing', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer', false);
        await daemon.worker.settled();

        expect(await verb(daemon, child.childId, 'done', ['--result', 'Both bugs fixed'])).toEqual([`done\t${child.taskId}\tchat-lead`]);
        daemon.adapter.forSession(child.childId).exit(0);
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        expect(daemon.tasks.get(child.taskId)).toMatchObject({ status: 'done', result: { source: 'done', text: 'Both bugs fixed' } });
        expect(daemon.alerts).toEqual([]);
    });

    test('a terminal agent is refused a task', async () => {
        const daemon = await boot();
        const [line] = await verb(daemon, 'term-lead', 'agent', ['claude', '--chat', '--task', 'Lexer', '--prompt', 'fix it']);
        expect(line).toStartWith('refused\tnot-a-chat-parent\t');
        expect(daemon.tasks.involving('term-lead')).toEqual([]);
    });

    test('a restart between a child settling and the lead waking still wakes the lead exactly once', async () => {
        const first = await boot();
        first.worker.start();
        await leadWorking(first);
        const child = await delegate(first, 'Lexer', 'fix the tokenizer');
        await first.until(settledTasks(first, 1));
        await first.worker.settled();
        expect(first.outbox.list().map((entry) => entry.kind)).toEqual(['wake-parent']);
        running.splice(running.indexOf(first), 1);
        await first.stop();

        const second = await boot();
        second.worker.start();
        // The lead's own turn is taken up again first; the wake waits for it and then goes out once.
        await second.chats.recoverInterrupted();
        await second.until(() => wakeTurns(second).some((turn) => turn.state === 'done'));
        await second.worker.settled();

        expect(wakeTurns(second).map((turn) => turn.taskIds)).toEqual([[child.taskId]]);
        const resumed = turnsOf(second, 'chat-lead').find((turn) => turn.origin !== 'agent');
        expect(resumed).toMatchObject({ state: 'done', attempt: 2 });
        expect(second.tasks.get(child.taskId)?.wake).toBe('sent');
        expect(second.outbox.list()).toEqual([]);
    });

    test('a child a person removes cancels its task, fails its row with a note and wakes nobody', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        // A question keeps the child's first turn open, so the task is still open when the node goes.
        const child = await delegate(daemon, 'Lexer', 'ask: which color');
        await daemon.until(() => daemon.chats.get(child.childId)?.info.activeTurnId !== null);

        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== child.childId), edges: [] } : view
                )
            },
            result: null
        }));
        await daemon.until(() => daemon.tasks.get(child.taskId)?.status === 'cancelled');
        await daemon.chats.kill(child.childId);
        await daemon.worker.settled();
        await daemon.until(() => leadItems(daemon).some((item) => item.kind === 'note' && item.level === 'warning'));

        expect(daemon.tasks.get(child.taskId)).toMatchObject({ status: 'cancelled', wake: 'none' });
        expect(leadItems(daemon).find((item) => item.kind === 'subagent')).toMatchObject({ status: 'failed', childId: child.childId });
        expect(wakeTurns(daemon)).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });
});
