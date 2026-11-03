import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { FakeCheckpoints } from './chat-test-helpers.ts';
import { makeChatFixture, retire } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let store: ChatFixture['store'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
let remake: ChatFixture['remake'];
let open: ChatFixture['open'];
beforeEach(async () => {
    ({ home, store, claude, manager, recorder, makeManager, open, remake } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('a CLI that dies mid-turn leaves an error note and the chat can go on', async () => {
    await open(manager, 'chat-6');
    await manager.send('chat-6', 'crash');
    await recorder.until(() => recorder.crashed);
    expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });
    expect(recorder.ofKind('turn')[0]?.state).toBe('error');

    await manager.send('chat-6', 'again');
    await recorder.untilIdle();
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again']);
    expect(claude.started).toHaveLength(2);
});

test('a turn the plan refused ends in an error that names the limit and its reset, and the chat can go on', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
        await open(manager, 'chat-limit');
        await manager.send('chat-limit', 'limit:1789000000');
        await recorder.untilIdle();
        expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'error', limit: { kind: 'usage', resetsAt: 1_789_000_000_000 } });
        expect(recorder.ofKind('note').map((note) => note.text)).toContain("You've hit your session limit · resets 3pm");
        expect(recorder.info?.limit).toEqual({ kind: 'usage', resetsAt: 1_789_000_000_000 });

        await manager.send('chat-limit', 'overloaded');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(recorder.ofKind('turn')[1]).toMatchObject({ state: 'error', limit: { kind: 'overload' } });
        expect(recorder.info?.limit).toEqual({ kind: 'overload' });

        // The next turn leaves the limit behind, as soon as it opens.
        await manager.send('chat-limit', 'fine');
        expect(recorder.info?.limit).toBeUndefined();
        await recorder.until(() => recorder.info?.usage.turns === 3 && recorder.idle);
        expect(recorder.info?.limit).toBeUndefined();
    } finally {
        now.mockRestore();
    }
});

test('a CLI that dies with something on stderr leaves the last lines of it in the note', async () => {
    await open(manager, 'chat-loud');
    await manager.send('chat-loud', 'crash loudly');
    await recorder.until(() => recorder.crashed);
    const tail = [...Array<string>(8).fill('warming up'), 'Error: the fake lost its key', '    at handleUser (fake-claude.ts)'].join('\n');
    expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: `Claude Code exited with code 1\n\n\`\`\`\n${tail}\n\`\`\`` });
});

test('what a crashed CLI left queued goes out before the next message, in the order it was sent', async () => {
    await open(manager, 'chat-cq');
    await manager.send('chat-cq', 'slow');
    await manager.send('chat-cq', 'B');
    await manager.send('chat-cq', 'C');
    claude.started[0]!.crash(1);
    await recorder.until(() => recorder.crashed);
    expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['B', 'C']);

    expect(await manager.send('chat-cq', 'D')).toMatchObject({ queued: true });
    await recorder.until(() => recorder.ofKind('assistant').length === 3 && recorder.idle);
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['slow', 'B', 'C', 'D']);
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: B', 'echo: C', 'echo: D']);
    expect(recorder.info?.queue).toEqual([]);
});

test('the record holds a turn while it is still running', async () => {
    await open(manager, 'chat-open');
    await manager.send('chat-open', 'slow');
    await store.written('chat-open', (record) => record.items.some((item) => item.kind === 'turn' && item.state === 'running'));

    const stored = await store.read('chat-open');
    expect(stored?.items.map((item) => item.kind)).toEqual(['turn', 'user']);
    expect(stored?.info.activeTurnId).not.toBeNull();
    manager.cancel('chat-open');
    await recorder.until(() => recorder.info?.activeTurnId === null);
    expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'aborted' });
});

test('kill drops the thread and its record, after the write that was still out', async () => {
    await open(manager, 'chat-7');
    // The first write of a chat is the whole record, later changes only go to its log.
    const held = store.holdNextWrite('chat-7');
    await manager.send('chat-7', 'x');
    await held.entered;

    const killed = manager.kill('chat-7');
    // A turn of the event loop, so a kill that did not wait for the write would have asked for the delete by now.
    await new Promise((resolve) => setImmediate(resolve));
    held.release();
    await killed;
    await held.landed;
    expect(store.calls.filter((call) => call.endsWith('chat-7')).at(-1)).toBe('delete chat-7');
    expect(manager.list()).toEqual([]);
    expect(await store.read('chat-7')).toBeNull();
    expect(() => manager.send('chat-7', 'x')).toThrow('No chat');
});

test('messages sent during a turn queue in order and go out when it settles', async () => {
    await open(manager, 'chat-q');
    const first = await manager.send('chat-q', 'first');
    const second = await manager.send('chat-q', 'second');
    const third = await manager.send('chat-q', 'third');
    expect(first).toMatchObject({ queued: false });
    expect(second).toMatchObject({ queued: true });
    expect(third).toMatchObject({ queued: true });
    expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['second', 'third']);

    await recorder.until(() => recorder.ofKind('user').length === 3 && recorder.idle);
    const messages = recorder.ofKind('user');
    expect(messages.map((item) => item.text)).toEqual(['first', 'second', 'third']);
    expect(messages.map((item) => item.turnId)).toEqual([first.turnId, second.turnId, third.turnId]);
    expect(recorder.info?.queue).toEqual([]);
});

test('a queued message can be dropped, and the queue survives a reload', async () => {
    await open(manager, 'chat-q2');
    // A turn that waits for an interrupt keeps the queue from draining while the test looks at it.
    await manager.send('chat-q2', 'slow');
    await manager.send('chat-q2', 'dropped');
    await manager.send('chat-q2', 'kept');
    const queue = recorder.info!.queue!;
    manager.unqueue('chat-q2', queue[0]!.id);
    expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['kept']);
    expect(() => manager.unqueue('chat-q2', queue[0]!.id)).toThrow('No queued message');

    // A daemon that goes down mid-turn must not lose what was waiting behind it, which the log holds at once.
    manager.get('chat-q2')?.dispose();
    const reloaded = makeManager();
    expect((await reloaded.create({ chatId: 'chat-q2' })).queue?.map((message) => message.text)).toEqual(['kept']);
    await retire(reloaded);
});

test('a queued message taken back to edit comes back whole, and one that already went out comes back as nothing', async () => {
    await open(manager, 'chat-q4');
    await manager.send('chat-q4', 'slow');
    const upload = { name: 'note.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') };
    await manager.send('chat-q4', 'see @src/a.ts', { mentions: ['src/a.ts'], skills: ['review'] }, [upload]);
    await manager.send('chat-q4', 'next');
    const [edited, sent] = recorder.info!.queue!;
    const session = manager.get('chat-q4')!;

    expect(session.unqueue(edited!.id)).toMatchObject({
        id: edited!.id,
        text: 'see @src/a.ts',
        mentions: ['src/a.ts'],
        skills: ['review'],
        attachments: [{ name: 'note.txt', mime: 'text/plain', size: 5 }]
    });
    expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['next']);

    session.sendNow(sent!.id);
    await recorder.until(() => recorder.ofKind('user').some((item) => item.text === 'next'));
    expect(session.unqueue(sent!.id)).toBeNull();
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['slow', 'next']);
});

test('send now stops the running turn and puts that message first', async () => {
    await open(manager, 'chat-q3');
    await manager.send('chat-q3', 'slow');
    await manager.send('chat-q3', 'waiting');
    await manager.send('chat-q3', 'urgent');
    const urgent = recorder.info!.queue!.find((message) => message.text === 'urgent')!;
    manager.sendNow('chat-q3', urgent.id);

    await recorder.until(() => recorder.ofKind('user').length === 3);
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['slow', 'urgent', 'waiting']);
});

describe('clearing a chat', () => {
    test('empties the thread on disk and the next send starts the CLI without resuming', async () => {
        await open(manager, 'chat-clear', { selection: { model: 'opus', options: {} } });
        await manager.send('chat-clear', 'first');
        await recorder.untilIdle();
        const first = recorder.info!;

        await manager.clear('chat-clear');
        expect(recorder.events.at(-1)).toMatchObject({ type: 'reset', items: [] });
        expect(recorder.info).toMatchObject({
            agentSessionId: null,
            running: false,
            status: 'idle',
            activeTurnId: null,
            queue: [],
            slashCommands: [],
            usage: { contextTokens: 0, turns: 1, costUsd: first.usage.costUsd }
        });
        const stored = await store.read('chat-clear');
        expect(stored?.items).toEqual([]);
        expect(stored?.info).toMatchObject({ provider: 'claude', selection: first.selection, agentSessionId: null, queue: [] });

        await manager.send('chat-clear', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(claude.started.at(-1)!.argv).not.toContain('--resume');
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.info?.agentSessionId).not.toBe(first.agentSessionId);
        expect(manager.attach('chat-clear', 'c1').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['second']);
    });

    test('the window is the pick\u2019s again, not the one the session that went reported', async () => {
        const chatId = 'chat-clear-window';
        // A chat left behind by a CLI that ran on 1M while the pick had moved to 200k.
        await store.write(
            chatId,
            {
                chatId,
                provider: 'claude',
                cwd: home,
                agentSessionId: 'fake-old',
                model: 'claude-opus-5[1m]',
                selection: { model: 'claude-opus-5', options: { effort: 'high', contextWindow: '200k', fastMode: false } },
                runtimeMode: 'full-access',
                status: 'idle',
                running: false,
                activeTurnId: null,
                slashCommands: [],
                usage: { contextTokens: 1200, contextWindow: 1_000_000, costUsd: 0.5, turns: 3 },
                createdAt: 1
            },
            []
        );
        // Loading it is enough: the window a session that is gone left behind is the pick's again.
        expect((await manager.create({ chatId })).usage).toMatchObject({ contextTokens: 1200, contextWindow: 200_000, turns: 3 });
        manager.attach(chatId, 'c1');

        await manager.clear(chatId);
        expect(recorder.info?.usage).toMatchObject({ contextTokens: 0, contextWindow: 200_000, turns: 3 });
    });

    test('a running turn is refused without force; with force the CLI goes and nothing of the turn comes back', async () => {
        const diff: ChatCheckpointDiff = { files: [{ path: 'seed.txt', kind: 'update', added: 1, deleted: 1, diff: '-seed\n+other\n' }], truncated: false };
        const checkpoints = new FakeCheckpoints('b'.repeat(40), diff);
        manager = await remake(manager, { checkpoints });

        await open(manager, 'chat-busy');
        await manager.send('chat-busy', 'tool: date');
        await manager.send('chat-busy', 'queued');
        await recorder.until(() => recorder.info?.status === 'needs-you' && recorder.ofKind('turn')[0]?.checkpoint !== undefined);

        await expect(manager.clear('chat-busy')).rejects.toMatchObject({ code: 'chat-busy' });
        expect(recorder.ofKind('approval')).toHaveLength(1);
        expect(manager.get('chat-busy')?.info.queue).toHaveLength(1);

        await manager.clear('chat-busy', true);
        expect(manager.get('chat-busy')?.running).toBe(false);
        expect(manager.get('chat-busy')?.pid).toBeNull();
        expect(manager.attach('chat-busy', 'c1').items).toEqual([]);
        expect(recorder.info).toMatchObject({ status: 'idle', activeTurnId: null, queue: [] });

        // Whatever the killed CLI or the settled checkpoint still had on its way must not bring the turn back.
        await claude.started[0]!.exited;
        await checkpoints.settled();
        expect(recorder.items.size).toBe(0);
        expect(manager.attach('chat-busy', 'c1').items).toEqual([]);
        expect((await store.read('chat-busy'))?.items).toEqual([]);
    });
});
