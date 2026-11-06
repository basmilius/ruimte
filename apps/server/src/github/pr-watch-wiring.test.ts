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

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-watcher', kind: 'chat', title: 'Watcher', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

const page = JSON.stringify({
    data: {
        repository: {
            pullRequest: {
                number: 12,
                url: 'https://github.com/o/r/pull/12',
                state: 'OPEN',
                headRefOid: 'abc1234def',
                commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }] }
            }
        }
    }
});

let root: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;
let holdTurn = false;
let releaseTurn: (() => void) | null = null;
let heldTurn = Promise.withResolvers<void>();

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-pr-watch-wiring-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks(), projectOverlays(join(root, 'home')));
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    holdTurn = false;
    releaseTurn = null;
    heldTurn = Promise.withResolvers<void>();
    daemon = await bootTestDaemon({
        home: join(root, 'home'),
        store,
        clock: new ManualClock(),
        claudeCli: (io) =>
            fakeClaude({
                ...io,
                out: (frame) => {
                    if (holdTurn && (frame as { type?: string }).type === 'result') {
                        releaseTurn = () => io.out(frame);
                        heldTurn.resolve();
                        return;
                    }
                    io.out(frame);
                }
            }),
        gh: (args) =>
            Promise.resolve(
                args[0] === 'pr'
                    ? { code: 0, stdout: JSON.stringify({ number: 12, url: 'https://github.com/o/r/pull/12' }), stderr: '' }
                    : { code: 0, stdout: page, stderr: '' }
            )
    });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function turnsOf(): ChatTurnItem[] {
    return (daemon.chats.get('chat-watcher')?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

async function owe(): Promise<void> {
    const watch = await daemon.prWatches.start(projectId, 'chat-watcher', folder);
    await daemon.worker.enqueue(projectId, 'chat-watcher', {
        kind: 'deliver-pr-watch',
        payload: { watchId: watch.id, key: 'checks:abc1234def:failure', text: 'Checks on abc1234 finished: failed: lint.', label: 'PR #12: checks failed' }
    });
}

describe('a pull request watch waking a chat', () => {
    test('opens one agent turn with the label of the news', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await owe();
        await daemon.until(() => turnsOf().some((turn) => turn.label === 'PR #12: checks failed' && turn.state === 'done'));
        const woken = turnsOf().filter((turn) => turn.label === 'PR #12: checks failed');
        expect(woken).toHaveLength(1);
        expect(woken[0]!.origin).toBe('agent');
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat in a turn keeps the wake until the turn ends, and runs it once', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        holdTurn = true;
        await daemon.chats.send('chat-watcher', 'plan the work');
        await heldTurn.promise;
        expect(releaseTurn).not.toBeNull();
        await daemon.until(() => turnsOf()[0]?.state === 'running');
        await owe();
        await daemon.worker.settled();
        expect(turnsOf()).toHaveLength(1);
        expect(turnsOf()[0]?.state).toBe('running');
        expect(daemon.outbox.list()).toMatchObject([{ kind: 'deliver-pr-watch', target: 'chat-watcher', attempts: 0 }]);
        holdTurn = false;
        releaseTurn!();
        await daemon.until(() => turnsOf().some((turn) => turn.label === 'PR #12: checks failed' && turn.state === 'done'));
        expect(turnsOf().filter((turn) => turn.label === 'PR #12: checks failed')).toHaveLength(1);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat in a closed project keeps the wake until the project opens again', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await store.closeProject(projectId, 'client-1');
        await owe();
        await daemon.worker.settled();

        expect(turnsOf()).toEqual([]);
        expect(daemon.outbox.list()).toMatchObject([{ kind: 'deliver-pr-watch', target: 'chat-watcher', attempts: 0 }]);

        await store.openProject({ projectId });
        await daemon.until(() => turnsOf().some((turn) => turn.label === 'PR #12: checks failed' && turn.state === 'done'));

        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a watch that ended takes its wake along', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await daemon.worker.enqueue(projectId, 'chat-watcher', {
            kind: 'deliver-pr-watch',
            payload: { watchId: 'gone', key: 'k', text: 'Checks finished.', label: 'PR #12: checks failed' }
        });
        await daemon.worker.settled();
        expect(daemon.outbox.list()).toEqual([]);
        expect(turnsOf()).toEqual([]);
    });
});
