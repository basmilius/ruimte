import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { CanvasHost } from '../canvas/verb.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { failTasksOfClosedProject } from './closed-project.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from './test-daemon.ts';

let root: string;
let home: string;
let ownId: string;
let otherId: string;
let other: string;
let store: ProjectStore;
let daemon: TestDaemon | null;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-cross-project-'));
    home = join(root, 'home');
    const own = join(root, 'repo');
    other = join(root, 'other');
    await mkdir(own);
    await mkdir(other);
    daemon = null;
    // The links reach the daemon once it is booted, which needs the store first.
    store = new ProjectStore(
        home,
        projectLinks({
            endSession: async (kind, nodeId) => daemon?.host.endSession(kind, nodeId),
            closing: (name, nodeIds) =>
                daemon &&
                failTasksOfClosedProject({ tasks: daemon.tasks, locate: (id) => store.index.locate(id), coordinator: daemon.wiring.coordinator }, name, nodeIds)
        })
    );
    const opened = await store.openProject({ folder: own });
    ownId = opened.summary.projectId;
    await store.save(ownId, opened.document.rev, {
        name: 'repo',
        color: '#123456',
        views: [{ kind: 'chat', id: 'chat-lead', name: 'Lead', node: { provider: 'claude' } }]
    });
    const second = await store.openProject({ folder: other });
    otherId = second.summary.projectId;
    await store.save(otherId, second.document.rev, {
        name: 'other',
        color: '#654321',
        views: [{ kind: 'canvas', id: 'work', name: 'Work', nodes: [], texts: [], edges: [], layouts: [] }]
    });
    store.hold('client-b', otherId);
});

afterEach(async () => {
    await daemon?.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function boot(): Promise<TestDaemon> {
    daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), installed: ['claude', 'codex'] });
    daemon.worker.start();
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: join(root, 'repo') });
    await daemon.chats.send('chat-lead', 'plan');
    await daemon.until(
        () =>
            daemon!.chats
                .get('chat-lead')
                ?.thread.list()
                .some((item) => item.kind === 'turn' && item.state === 'done') === true
    );
    return daemon;
}

/* The daemon's verbs with the machine's switch on and both projects open. */
function reaching(booted: TestDaemon): { host: CanvasHost } {
    return {
        host: {
            ...booted.host,
            reach: {
                enabled: () => true,
                open: async () =>
                    [
                        { projectId: ownId, name: 'repo', folder: join(root, 'repo') },
                        { projectId: otherId, name: 'other', folder: other }
                    ].filter((project) => store.holdersOf(project.projectId).length > 0 || project.projectId === ownId)
            }
        }
    };
}

async function delegate(booted: TestDaemon, prompt: string): Promise<{ childId: string; taskId: string }> {
    const lines = await runVerb(reaching(booted), 'chat-lead', 'agent', [
        'claude',
        '--project',
        otherId,
        '--view',
        'work',
        '--task',
        'Look',
        '--prompt',
        prompt
    ]);
    const fields = lines[0]!.split('\t');

    return { childId: fields[0]!, taskId: fields[5]! };
}

test('a child started in another project keeps its task through that project’s prunes and wakes its parent once', async () => {
    const booted = await boot();
    const { childId, taskId } = await delegate(booted, 'count primes');
    // A person adds a node there, which prunes what that project wrote down for ids it no longer has.
    await store.mutate(otherId, (content) => ({
        content: {
            ...content,
            views: content.views.map((view) =>
                view.kind === 'canvas' ? { ...view, nodes: [...view.nodes, { id: 'note-b', kind: 'note', title: 'Note', x: 0, y: 900, w: 320, h: 240 }] } : view
            )
        },
        result: null
    }));
    await booted.until(() => booted.tasks.get(taskId)?.wake === 'sent');
    await booted.worker.settled();

    expect(store.index.locate(childId)).toMatchObject({ projectId: otherId, canvasId: 'work' });
    expect(booted.tasks.get(taskId)).toMatchObject({ parentId: 'chat-lead', projectId: otherId, status: 'done' });
    expect(booted.chats.get(childId)?.info.cwd).toBe(other);
    expect(
        booted.chats
            .get('chat-lead')
            ?.thread.list()
            .filter((item) => item.kind === 'turn')
    ).toHaveLength(2);
});

test('a change in the other project ends no child whose parent stands in this one', async () => {
    const booted = await boot();
    const { childId, taskId } = await delegate(booted, 'slow');
    await booted.until(() => booted.chats.get(childId)?.info.activeTurnId != null);
    await store.save(otherId, await store.revision(otherId), { ...(await store.read(otherId)), name: 'other, renamed' });
    await booted.worker.settled();

    expect(booted.enqueued.filter((work) => work.kind === 'end-children')).toEqual([]);
    expect(booted.chats.get(childId)?.info.activeTurnId).not.toBeNull();
    expect(booted.tasks.get(taskId)?.status).toBe('open');
});

test('closing the other project in its last window ends the child, fails its task and wakes the parent once', async () => {
    const booted = await boot();
    const { childId, taskId } = await delegate(booted, 'slow');
    await booted.until(() => booted.chats.get(childId)?.info.activeTurnId != null);
    await store.closeProject(otherId, 'client-b');
    await booted.until(() => booted.tasks.get(taskId)?.wake === 'sent');
    await booted.worker.settled();

    expect(booted.tasks.get(taskId)).toMatchObject({
        status: 'failed',
        result: { text: 'The project other was closed in its last window, which ended this agent.' }
    });
    expect(booted.chats.get(childId)?.info.activeTurnId ?? null).toBeNull();
    expect(
        booted.chats
            .get('chat-lead')
            ?.thread.list()
            .filter((item) => item.kind === 'turn')
    ).toHaveLength(2);
    const refused = await runVerb(reaching(booted), 'chat-lead', 'view', ['list', '--project', otherId]);
    expect(refused[0]).toStartWith('refused\tproject-not-open\t');
});
