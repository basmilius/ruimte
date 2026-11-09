import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeClaude, ManualClock } from '@adecore/agents/testing';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { projectOverlays } from '../projects/overlays.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../testing/test-daemon.ts';

const CHAT = 'chat-watcher';
const LEAD = 'chat-lead';
const WATCH = { id: 'b1', kind: 'shell' as const, description: 'Watch CI', command: 'gh run watch 42 --exit-status', startedAt: 1 };

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: CHAT, kind: 'chat', title: 'Watcher', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: LEAD, kind: 'chat', title: 'Lead', x: 600, y: 0, w: 560, h: 640, provider: 'claude' }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

let root: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-deliver-lost-work-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks(), projectOverlays(join(root, 'home')));

    const opened = await store.openProject({ folder });

    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }

    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function boot(): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock(), claudeCli: fakeClaude });
    running.push(daemon);

    return daemon;
}

/* A daemon that goes down while the chat runs `gh run watch` in the background, and the one that starts after it. */
async function restartWhileWatching(before?: (daemon: TestDaemon) => Promise<void>): Promise<TestDaemon> {
    const first = await boot();
    await first.chats.create({ chatId: CHAT, provider: 'claude', cwd: folder });
    await before?.(first);
    first.chats.get(CHAT)!.thread.patchInfo({ background: [WATCH] });
    await first.chats.save(CHAT);
    await first.stop();
    running = [];

    const second = await boot();
    await second.chats.recoverInterrupted();

    return second;
}

function wakes(daemon: TestDaemon): ChatTurnItem[] {
    return (daemon.chats.get(CHAT)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn' && item.label === 'Machine restarted');
}

describe('background commands a restart took', () => {
    test('wake an idle chat once, as hop 0, with the note that names them', async () => {
        const daemon = await restartWhileWatching();
        await daemon.until(() => wakes(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(wakes(daemon)).toHaveLength(1);
        expect(wakes(daemon)[0]).toMatchObject({ origin: 'agent' });
        expect(wakes(daemon)[0]!.messageHop).toBeUndefined();
        expect(daemon.chats.get(CHAT)!.thread.get('lost:b1')).toMatchObject({
            kind: 'note',
            text: expect.stringContaining('- command "gh run watch 42 --exit-status"')
        });
        expect(daemon.outbox.list()).toEqual([]);

        await daemon.stop();
        running = [];
        const again = await boot();
        await again.chats.recoverInterrupted();
        await again.worker.settled();

        // The record is settled now, so the next start does not even load the chat.
        expect(again.chats.get(CHAT)).toBeUndefined();
        expect(again.outbox.list()).toEqual([]);
    });

    test('owe a task child nothing, since its parent hears through the task', async () => {
        const daemon = await restartWhileWatching(async (first) => {
            await first.chats.create({ chatId: LEAD, provider: 'claude', cwd: folder });
            await first.tasks.open({ projectId, parentId: LEAD, childId: CHAT, title: 'Watch CI', prompt: 'watch' }, 1);
        });
        await daemon.worker.settled();

        expect(daemon.outbox.list().filter((entry) => entry.kind === 'deliver-lost-work')).toEqual([]);
        expect(wakes(daemon)).toEqual([]);
    });

    test('owe a node that was ended nothing', async () => {
        const first = await boot();
        await first.chats.create({ chatId: CHAT, provider: 'claude', cwd: folder });
        first.chats.get(CHAT)!.thread.patchInfo({ background: [WATCH] });
        await first.chats.save(CHAT);
        await first.lineage.put({ projectId, nodeId: CHAT, openedBy: LEAD, depth: 1, agent: true });
        await first.lineage.markEnded([CHAT]);
        await first.stop();
        running = [];

        const daemon = await boot();
        await daemon.chats.recoverInterrupted();
        await daemon.worker.settled();

        expect(wakes(daemon)).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('wait while the project is closed', async () => {
        await store.closeProject(projectId, 'client-1');
        const daemon = await restartWhileWatching();
        await daemon.worker.settled();

        expect(wakes(daemon)).toEqual([]);
        expect(daemon.outbox.list()).toMatchObject([{ kind: 'deliver-lost-work', target: CHAT, payload: { noteId: 'lost:b1' } }]);

        await store.openProject({ projectId });
        await daemon.until(() => wakes(daemon).some((turn) => turn.state === 'done'));

        expect(daemon.outbox.list()).toEqual([]);
    });
});
