import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { ProjectContent } from '@ruimte/contracts';
import { sayAndSettle } from '../chat/lead-chat-test-helpers.ts';
import { routineOpener } from '../opener.ts';
import { documentPathInFolder } from '../projects/project-files.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, releasedProject, turnsOf, type TestDaemon } from '../testing/test-daemon.ts';

// The manual clock starts at 1 000 000 ms, so the fake is told a reset ten minutes on, in seconds.
const RESET_AT = 1_600_000;

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
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'chat-child', kind: 'chat', title: 'Child', x: 600, y: 0, w: 560, h: 640, provider: 'claude' }
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
let clock: ManualClock;
let daemon: TestDaemon;

beforeEach(async () => {
    const released = await releasedProject('ruimte-closed-project-', content());
    ({ root, folder, store, projectId } = released);
    clock = new ManualClock();
    daemon = await bootTestDaemon({ home: released.home, store, clock, machine: { resumeAtReset: true } });
    await store.closeProject(projectId, 'client-1');
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function owed(kind: string): number {
    return daemon.outbox.list().filter((entry) => entry.kind === kind).length;
}

async function ownedBy(who: 'peer' | 'routine' | 'child of a routine' | 'holder' | 'person'): Promise<void> {
    switch (who) {
        case 'peer':
            await daemon.lineage.put({ projectId, nodeId: 'chat-lead', openedBy: 'chat-there', depth: 1, agent: true, peer: { machineId: 'machine-a' } });
            break;
        case 'routine':
            await store.hiddenAgents.put({
                projectId,
                openedBy: routineOpener('routine-1'),
                node: { id: 'chat-lead', kind: 'chat', title: 'Run', x: 0, y: 0, w: 480, h: 560 }
            });
            break;
        case 'child of a routine':
            await store.hiddenAgents.put({
                projectId,
                openedBy: routineOpener('routine-1'),
                node: { id: 'chat-run', kind: 'chat', title: 'Run', x: 0, y: 0, w: 480, h: 560 }
            });
            await daemon.lineage.put({ projectId, nodeId: 'chat-lead', openedBy: 'chat-run', depth: 1, agent: true });
            break;
        case 'holder':
            store.hold('peer-channel', projectId, { startsLaunches: false });
            break;
        case 'person':
            break;
    }
}

async function finishTaskOf(parentId: string, inProject = projectId): Promise<string> {
    const task = await daemon.tasks.open({ projectId: inProject, parentId, childId: 'chat-child', title: 'Result', prompt: 'go' }, 1);
    await daemon.wiring.coordinator.done('chat-child', 'the result');

    return task.id;
}

/* A second checkout of the repository, open with the first one's shared canvas while the first is closed, as a person has to do it. */
async function secondCheckout(): Promise<{ folder: string; projectId: string }> {
    const opened = await store.openProject({ projectId });
    await store.save(projectId, opened.document.rev, content(), ['main']);

    const other = join(root, 'repo-2');
    await mkdir(join(other, '.ruimte'), { recursive: true });
    await writeFile(documentPathInFolder(other), await readFile(documentPathInFolder(folder), 'utf8'));
    await store.closeProject(projectId, 'client-1');

    const copy = await store.openProject({ folder: other });

    return { folder: other, projectId: copy.summary.projectId };
}

describe('work in a project a person closed', () => {
    test.each(['peer', 'routine', 'child of a routine', 'holder'] as const)('a resume after a limit of a chat of a %s still runs', async (who) => {
        await ownedBy(who);
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await sayAndSettle(daemon, 'chat-lead', `limit:${RESET_AT / 1000}`);
        expect(owed('resume-limit')).toBe(1);

        clock.advance(RESET_AT - clock.now());
        await daemon.until(() => turnsOf(daemon, 'chat-lead').length === 2);
        await daemon.worker.settled();

        expect(owed('resume-limit')).toBe(0);
    });

    test.each(['peer', 'routine', 'child of a routine', 'holder'] as const)('a finished task wakes a chat of a %s', async (who) => {
        await ownedBy(who);
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await sayAndSettle(daemon, 'chat-lead', 'hello');
        const taskId = await finishTaskOf('chat-lead');

        await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
        await daemon.worker.settled();

        expect(owed('wake-parent')).toBe(0);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(2);
    });

    test('a project that closes while a wake loads its stored chat opens no turn, and the wake runs after the next open', async () => {
        await store.openProject({ projectId });
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await sayAndSettle(daemon, 'chat-lead', 'hello');
        await daemon.chats.stop('chat-lead', 'nobody has it open');
        expect(await daemon.chats.unloadIdle('chat-lead')).toBe(true);

        const loading = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const hasStored = daemon.chats.hasStored.bind(daemon.chats);
        daemon.chats.hasStored = async (chatId) => {
            loading.resolve();
            await release.promise;

            return hasStored(chatId);
        };
        const taskId = await finishTaskOf('chat-lead');
        await loading.promise;

        const closing = store.closeProject(projectId, 'client-1');
        release.resolve();
        await closing;
        await daemon.worker.settled();

        expect(await store.isClosed(projectId)).toBe(true);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(1);
        expect(owed('wake-parent')).toBe(1);

        await store.openProject({ projectId });
        await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
        await daemon.worker.settled();

        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(2);
        expect(owed('wake-parent')).toBe(0);
    });

    test('a chat of a person waits for the project, a resume and a finished task alike', async () => {
        await ownedBy('person');
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await sayAndSettle(daemon, 'chat-lead', `limit:${RESET_AT / 1000}`);
        await finishTaskOf('chat-lead');

        clock.advance(RESET_AT - clock.now());
        await daemon.worker.settled();

        expect(owed('resume-limit')).toBe(1);
        expect(owed('wake-parent')).toBe(1);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(1);
    });

    test('a chat on a shared canvas wakes in the open copy while the first copy stays closed', async () => {
        const copy = await secondCheckout();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: copy.folder });
        await sayAndSettle(daemon, 'chat-lead', 'hello');
        const taskId = await finishTaskOf('chat-lead', copy.projectId);

        await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
        await daemon.worker.settled();

        expect(await store.isClosed(projectId)).toBe(true);
        expect(owed('wake-parent')).toBe(0);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(2);
    });

    test('a chat on a shared canvas waits while both copies are closed, and opening the second releases it', async () => {
        const copy = await secondCheckout();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: copy.folder });
        await sayAndSettle(daemon, 'chat-lead', 'hello');
        await store.closeProject(copy.projectId, 'client-1');
        const taskId = await finishTaskOf('chat-lead', copy.projectId);
        await daemon.worker.settled();

        expect(owed('wake-parent')).toBe(1);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(1);

        await store.openProject({ projectId: copy.projectId });
        await daemon.until(() => daemon.tasks.get(taskId)?.wake === 'sent');
        await daemon.worker.settled();

        expect(owed('wake-parent')).toBe(0);
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(2);
    });
});
