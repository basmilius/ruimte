import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';

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
                { id: 'term-other', kind: 'terminal', title: 'Other', x: 0, y: 700, w: 560, h: 360 }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

let root: string;
let store: ProjectStore;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-operations-'));
    const folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'));
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
    daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock() });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const operation = (caller: string, id: string): Promise<string[]> => runVerb(daemon, caller, 'operation', ['get', id]);

const firstTurnDone = (chatId: string): boolean =>
    daemon.chats
        .get(chatId)
        ?.thread.list()
        .some((item): item is ChatTurnItem => item.kind === 'turn' && item.state === 'done') === true;

test('a start with a task is queued until the outbox runs it, running while the task is open, and completed once it is done', async () => {
    const [line] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--terminal', '--task', 'Lexer', '--prompt', 'fix the lexer']);
    const [child, , , , , taskId] = line!.split('\t');
    const id = `agent.start:${child}`;

    expect(await operation('chat-lead', id)).toEqual([
        `operation\t${id}\tagent.start\tqueued`,
        `agent\t${child}\tqueued\t${taskId}\tits start is owed and runs next`
    ]);

    daemon.worker.start();
    await daemon.worker.settled();
    expect(await operation('chat-lead', id)).toEqual([`operation\t${id}\tagent.start\trunning`, `agent\t${child}\trunning\t${taskId}\tits task is open`]);

    await runVerb(daemon, child!, 'done', ['--result', 'fixed']);
    // The wake it owes the lead runs before anything is torn down.
    await daemon.until(() => daemon.outbox.list().some((entry) => entry.kind === 'wake-parent'));
    await daemon.worker.settled();
    expect((await operation('chat-lead', id))[0]).toBe(`operation\t${id}\tagent.start\tcompleted`);
});

test('a start without a task is completed once the agent ran its first turn', async () => {
    const [line] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--prompt', 'say hello']);
    const child = line!.split('\t')[0]!;

    daemon.worker.start();
    await daemon.worker.settled();
    await daemon.until(() => firstTurnDone(child));

    expect(await operation('chat-lead', `agent.start:${child}`)).toEqual([
        `operation\tagent.start:${child}\tagent.start\tcompleted`,
        `agent\t${child}\tcompleted\t-\tthe start is done: its first turn ended and it waits for a message, which says nothing about whether the work is`
    ]);
});

test('a cancelled start reads cancelled once its turn stopped, and not completed', async () => {
    const [line] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--prompt', 'slow']);
    const child = line!.split('\t')[0]!;
    const id = `agent.start:${child}`;

    daemon.worker.start();
    await daemon.worker.settled();
    await daemon.until(() => daemon.chats.get(child)?.info.status === 'running');

    const [cancelled] = await runVerb(daemon, 'chat-lead', 'operation', ['cancel', id]);
    expect(cancelled).toStartWith(`operation\t${id}\tcancelled\t${child}: its turn is told to stop`);
    await daemon.until(() => daemon.chats.get(child)?.info.status === 'idle');

    expect(await operation('chat-lead', id)).toEqual([
        `operation\t${id}\tagent.start\tcancelled`,
        `agent\t${child}\tcancelled\t-\tits turn was stopped before it finished; the chat and its thread stay`
    ]);
});

test('a team is one operation over its roles, and only the one who started it may follow it', async () => {
    const roles = [
        { title: 'One', prompt: 'a', provider: 'claude', terminal: true },
        { title: 'Two', prompt: 'b', provider: 'claude', terminal: true }
    ];
    const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--roles', JSON.stringify(roles)]);
    const ids = lines.slice(1).map((row) => row.split('\t')[0]!);
    const id = `team.start:${ids.join(',')}`;

    const read = await operation('chat-lead', id);
    expect(read[0]).toBe(`operation\t${id}\tteam.start\tqueued`);
    expect(read.slice(1).map((row) => row.split('\t').slice(0, 3))).toEqual(ids.map((node) => ['agent', node, 'queued']));

    expect((await operation('term-other', id))[0]).toStartWith('refused\tnot-yours\t');
    expect((await operation('chat-lead', 'agent.start:')).at(0)).toStartWith('refused\tunknown-operation\t');
    expect((await operation('chat-lead', 'agent.start:chat-nowhere')).at(0)).toStartWith('refused\tunknown-operation\t');
});
