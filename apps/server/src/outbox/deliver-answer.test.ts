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
import { answerWake } from '../tunnels/tunnel-proposals.ts';

const CHAT = 'chat-tunnels';
const CONFIRMED = answerWake({ action: 'add', hostname: 'app.bmnw.nl', port: 5173 }, 'confirmed');

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: CHAT, kind: 'chat', title: 'Tunnels', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
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
let daemon: TestDaemon;
let holdTurn = false;
let releaseTurn: (() => void) | null = null;
let heldTurn = Promise.withResolvers<void>();

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-deliver-answer-'));
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
            })
    });
    await daemon.chats.create({ chatId: CHAT, provider: 'claude', cwd: folder });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function answered(): ChatTurnItem[] {
    return (daemon.chats.get(CHAT)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn' && item.label === CONFIRMED.label);
}

function lastReply(): string | undefined {
    return daemon.chats
        .get(CHAT)
        ?.thread.list()
        .flatMap((item) => (item.kind === 'assistant' ? [item.text] : []))
        .at(-1);
}

describe("a person's answer on a card", () => {
    test('opens one agent turn that hears the outcome, not as the person', async () => {
        await daemon.link.oweAnswer(CHAT, CONFIRMED);
        await daemon.until(() => answered().some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(answered()).toHaveLength(1);
        expect(answered()[0]!.origin).toBe('agent');
        expect(answered()[0]!.messageHop).toBeUndefined();
        expect(lastReply()).toBe(`echo: ${CONFIRMED.text}`);
        expect(
            daemon.chats
                .get(CHAT)
                ?.thread.list()
                .filter((item) => item.kind === 'user')
        ).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat in a turn hears it once that turn ends', async () => {
        holdTurn = true;
        await daemon.chats.send(CHAT, 'set up the dev server');
        await heldTurn.promise;
        await daemon.link.oweAnswer(CHAT, CONFIRMED);
        await daemon.worker.settled();

        expect(answered()).toEqual([]);
        expect(daemon.outbox.list()).toMatchObject([{ kind: 'deliver-answer', target: CHAT, attempts: 0 }]);

        holdTurn = false;
        releaseTurn!();
        await daemon.until(() => answered().some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(answered()).toHaveLength(1);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat in a closed project hears it once the project opens again', async () => {
        await store.closeProject(projectId, 'client-1');
        await daemon.link.oweAnswer(CHAT, CONFIRMED);
        await daemon.worker.settled();

        expect(answered()).toEqual([]);
        expect(daemon.outbox.list()).toMatchObject([{ kind: 'deliver-answer', target: CHAT }]);

        await store.openProject({ projectId });
        await daemon.until(() => answered().some((turn) => turn.state === 'done'));

        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat no project places is owed nothing', async () => {
        await daemon.link.oweAnswer('chat-nowhere', CONFIRMED);

        expect(daemon.outbox.list()).toEqual([]);
    });
});
