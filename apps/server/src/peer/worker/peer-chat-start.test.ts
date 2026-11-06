import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { ServerFrame } from '@ruimte/contracts';
import { projectOverlays } from '../../projects/overlays.ts';
import { projectLinks } from '../../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../../testing/test-daemon.ts';

const MACHINE = 'machine-a';

let root: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-peer-chat-start-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks(), projectOverlays(join(root, 'home')));
    projectId = (await store.openProject({ folder })).summary.projectId;
    await store.peers.bind(MACHINE, 'Studio', projectId);
    daemon = await bootTestDaemon({
        home: join(root, 'home'),
        store,
        clock: new ManualClock(),
        peer: {
            links: store.peers,
            git: () => {
                throw new Error('no git in this test');
            },
            notify: () => undefined
        }
    });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function createChat(chatId: string): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await daemon.dispatcher.handle(
        { id: 'window', send: (frame) => frames.push(frame) },
        JSON.stringify({ id: 'r', type: 'chat.create', payload: { chatId, provider: 'claude' } })
    );
    return frames[0]!;
}

test('a window cannot start the chat of a task another machine gave before the daemon did, so it never runs in the project folder', async () => {
    await daemon.peerTasks!.start(MACHINE, 'channel-1', {
        projectId,
        nodeId: 'chat-given',
        parentId: 'chat-parent',
        title: 'Fix it',
        prompt: 'Fix it',
        provider: 'claude',
        ceiling: 'full-access',
        depth: 1
    });
    expect(await createChat('chat-given')).toMatchObject({ ok: false, error: { code: 'peer-task-starting' } });
    expect(daemon.chats.get('chat-given')).toBeUndefined();

    daemon.worker.start();
    await daemon.worker.settled();
    expect(daemon.chats.get('chat-given')).toBeDefined();
    expect(await createChat('chat-given')).toMatchObject({ ok: true });
});

test('a chat of this machine is started by a window as always', async () => {
    expect(await createChat('chat-own')).toMatchObject({ ok: true });
});
