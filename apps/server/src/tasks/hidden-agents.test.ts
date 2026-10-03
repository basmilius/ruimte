import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@ruimte/agents/outbox/manual-clock';
import { MAX_OPENED_PER_CALLER } from '../canvas/depth.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from './test-daemon.ts';

let root: string;
let home: string;
let folder: string;
let projectId: string;
let store: ProjectStore;
let daemons: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-hidden-agents-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, {
        name: 'repo',
        color: '#123456',
        views: [{ kind: 'chat', id: 'chat-lead', name: 'Lead', node: { provider: 'claude' } }]
    });
    daemons = [];
});

afterEach(async () => {
    for (const daemon of daemons) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const boot = async (): Promise<TestDaemon> => {
    const daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), installed: ['claude', 'codex'] });
    daemons.push(daemon);
    return daemon;
};

const leadIdle = async (daemon: TestDaemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'plan');
    await daemon.until(
        () =>
            daemon.chats
                .get('chat-lead')
                ?.thread.list()
                .some((item) => item.kind === 'turn' && item.state === 'done') === true
    );
};

const delegate = async (daemon: TestDaemon, caller = 'chat-lead', prompt = 'count primes'): Promise<{ childId: string; taskId: string }> => {
    const lines = await runVerb(daemon, caller, 'agent', ['codex', '--model', 'gpt-6.1-sol', '--task', 'Primes', '--prompt', prompt]);
    const fields = lines[0]!.split('\t');
    expect(fields.slice(1, 5)).toEqual(['chat', '-', 'codex', '-']);
    return { childId: fields[0]!, taskId: fields[5]! };
};

test('a chat view delegates to the requested provider and model without adding a view or canvas', async () => {
    const daemon = await boot();
    daemon.worker.start();
    await leadIdle(daemon);
    const before = await store.read(projectId);
    const revision = await store.revision(projectId);
    const { childId, taskId } = await delegate(daemon);
    await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
    await daemon.worker.settled();

    expect(await store.read(projectId)).toEqual(before);
    expect(await store.revision(projectId)).toBe(revision);
    expect(store.index.locate(childId)).toEqual({ projectId, folder, canvasId: null });
    expect(store.index.sourcesFor(childId)).toEqual([]);
    expect(store.index.agentSource(childId)).toEqual({ id: childId, kind: 'chat', title: 'Primes' });
    expect(daemon.chats.get(childId)?.info).toMatchObject({ provider: 'codex', selection: { model: 'gpt-6.1-sol' } });
    const row = daemon.chats
        .get('chat-lead')
        ?.thread.list()
        .find((item) => item.kind === 'subagent');
    expect(row).toMatchObject({ origin: 'ruimte', childId, status: 'done' });
    if (row?.kind !== 'subagent') {
        throw new Error('No subagent row');
    }
    const page = await daemon.chats.subagent('client', { chatId: 'chat-lead', toolUseId: row.toolUseId });
    expect(page.items.some((item) => item.kind === 'assistant' && item.text.includes('count primes'))).toBe(true);
    expect(daemon.tasks.get(taskId)?.result?.text).toContain('count primes');
    expect(daemon.host.openedCount('chat-lead')).toBe(0);
});

test('hidden agent and team previews leave no sessions, records or project writes', async () => {
    const daemon = await boot();
    const revision = await store.revision(projectId);
    const agent = await runVerb(daemon, 'chat-lead', 'agent', ['codex', '--model', 'gpt-6.1-sol', '--prompt', 'count', '--dry-run']);
    expect(agent).toEqual(['dry-run\tchat\t-\tcodex\t-']);
    const team = await runVerb(daemon, 'chat-lead', 'team', [
        '--label',
        'Counters',
        '--roles',
        JSON.stringify([{ title: 'Counter', prompt: 'count', provider: 'codex', model: 'gpt-6.1-sol' }]),
        '--dry-run'
    ]);
    expect(team).toEqual(['dry-run\tchat\tCounter\t-\tcodex\t-']);
    expect(store.hiddenAgents.inProject(projectId)).toEqual([]);
    expect(daemon.outbox.list()).toEqual([]);
    expect(await store.revision(projectId)).toBe(revision);
});

test('a hidden team returns all results in one wake without a group on a canvas', async () => {
    const daemon = await boot();
    daemon.worker.start();
    await leadIdle(daemon);
    const lines = await runVerb(daemon, 'chat-lead', 'team', [
        '--label',
        'Counters',
        '--task',
        '--roles',
        JSON.stringify([
            { title: 'Counter', prompt: 'count primes', provider: 'codex', model: 'gpt-6.1-sol' },
            { title: 'Checker', prompt: 'check primes', provider: 'claude' }
        ])
    ]);
    expect(lines).toHaveLength(3);
    const taskIds = lines.slice(0, 2).map((line) => line.split('\t')[6]!);
    await daemon.until(() => taskIds.every((id) => daemon.tasks.get(id)?.wake === 'sent'));
    await daemon.worker.settled();
    expect((await store.read(projectId)).views.map((view) => view.id)).toEqual(['chat-lead']);
    expect(store.hiddenAgents.inProject(projectId)).toHaveLength(2);
    const wakes = daemon.chats
        .get('chat-lead')
        ?.thread.list()
        .filter((item) => item.kind === 'turn' && item.taskIds !== undefined);
    expect(wakes).toHaveLength(1);
    expect(wakes?.[0]).toMatchObject({ taskIds });
});

test('queued hidden agents and their lineage survive a restart of the machine', async () => {
    const first = await boot();
    await leadIdle(first);
    const { childId, taskId } = await delegate(first);
    await first.stop();
    daemons = [];
    store.closeAll();
    store = new ProjectStore(home);
    await store.warmIndex();
    const second = await boot();
    expect(store.index.locate(childId)).toEqual({ projectId, folder, canvasId: null });
    expect(second.lineage.startedBy(childId)).toBe('chat-lead');
    expect(second.lineage.depthOf(childId)).toBe(1);
    second.worker.start();
    await second.until(() => second.tasks.get(taskId)?.wake === 'sent');
    await second.worker.settled();
    expect(second.tasks.get(taskId)?.status).toBe('done');
    expect((await store.read(projectId)).views).toHaveLength(1);
});

test('a hidden chat can open a hidden helper and is held to the same depth and permission limits', async () => {
    const daemon = await boot();
    const { childId } = await delegate(daemon);
    const grandchild = await delegate(daemon, childId);
    expect(daemon.lineage.depthOf(grandchild.childId)).toBe(2);
    expect(daemon.tasks.get(grandchild.taskId)?.parentId).toBe(childId);
    expect((await runVerb(daemon, grandchild.childId, 'agent', ['codex']))[0]).toStartWith('refused\ttoo-deep\t');
    expect((await runVerb(daemon, childId, 'agent', ['codex', '--mode', 'full-access']))[0]).toStartWith('refused\tmode-above-parent\t');
});

test('a hidden agent accepts a follow-up task from its parent', async () => {
    const daemon = await boot();
    daemon.worker.start();
    await leadIdle(daemon);
    const { childId, taskId } = await delegate(daemon);
    await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
    await daemon.worker.settled();
    const lines = await runVerb(daemon, 'chat-lead', 'task', ['new', childId, '--prompt', 'check the count']);
    const followup = lines[0]!.split('\t')[1]!;
    await daemon.until(() => daemon.tasks.get(followup)?.wake === 'sent');
    await daemon.worker.settled();
    expect(daemon.tasks.get(followup)?.result?.text).toContain('check the count');
});

test('queued hidden agents count toward the concurrent agent limit', async () => {
    const daemon = await boot();
    for (let i = 0; i < MAX_OPENED_PER_CALLER; i++) {
        await delegate(daemon);
    }
    expect((await runVerb(daemon, 'chat-lead', 'agent', ['codex']))[0]).toStartWith('refused\ttoo-many-agents\t');
});

test('deleting the parent chat stops its hidden agents and removes their placement', async () => {
    const daemon = await boot();
    daemon.worker.start();
    await leadIdle(daemon);
    const { childId } = await delegate(daemon, 'chat-lead', 'slow');
    await daemon.until(() => daemon.chats.get(childId)?.info.activeTurnId != null);
    await store.mutate(projectId, (content) => ({ content: { ...content, views: [] }, result: undefined }));
    await daemon.until(() => daemon.enqueued.some((work) => work.kind === 'end-children'));
    await daemon.worker.settled();
    expect(daemon.chats.get(childId)?.info.activeTurnId).toBeNull();
    expect(store.hiddenAgents.get(childId)).toBeUndefined();
    expect(store.index.locate(childId)).toBeNull();
    expect(daemon.tasks.ofParent('chat-lead')).toEqual([]);
});
