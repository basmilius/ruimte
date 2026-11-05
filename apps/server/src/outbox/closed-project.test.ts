import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { ManualClock } from '@adecore/agents/testing';
import type { ProjectContent } from '@ruimte/contracts';
import { sayAndSettle } from '../chat/lead-chat-test-helpers.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { routineOpener } from '../routines/routines.ts';
import { bootTestDaemon, releasedProject, turnsOf, type TestDaemon } from '../tasks/test-daemon.ts';

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
    daemon.worker.start();
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

async function finishTaskOf(parentId: string): Promise<string> {
    const task = await daemon.tasks.open({ projectId, parentId, childId: 'chat-child', title: 'Result', prompt: 'go' }, 1);
    await daemon.wiring.coordinator.done('chat-child', 'the result');

    return task.id;
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
});
