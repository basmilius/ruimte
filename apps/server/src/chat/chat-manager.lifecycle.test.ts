import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { makeChatFixture, retire } from './chat-manager.fixture.test.ts';
import { ChatRecorder, FakeCheckpoints } from './chat-test-helpers.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
let remake: ChatFixture['remake'];
let open: ChatFixture['open'];
beforeEach(async () => {
    ({ home, claude, manager, recorder, makeManager, open, remake } = await makeChatFixture());
});
afterEach(async () => {
    setSystemTime();
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('create spawns nothing; the first send starts the CLI with the selection and streams a reply', async () => {
    const info = await manager.core.create({ chatId: 'chat-1', cwd: home });
    expect(info).toMatchObject({
        chatId: 'chat-1',
        provider: 'claude',
        cwd: home,
        running: false,
        status: 'idle',
        agentSessionId: null,
        runtimeMode: 'full-access',
        selection: { model: 'claude-sonnet-5-5', options: { effort: 'high', contextWindow: '200k' } },
        usage: { contextWindow: 200000 }
    });
    expect(manager.core.get('chat-1')?.running).toBe(false);
    expect(claude.started).toHaveLength(0);
    expect(manager.core.attach('chat-1', 'c1')).toEqual({ info, items: [], seq: 0 });

    await manager.core.send('chat-1', 'hello there');
    // The CLI starts behind the send, once the SDK it runs through has loaded.
    expect(manager.core.get('chat-1')?.info.activeTurnId).not.toBeNull();
    // A send while a turn runs queues instead of failing, so the test unqueues it to reach idle.
    expect(await manager.core.send('chat-1', 'again')).toMatchObject({ queued: true });
    manager.core.unqueue('chat-1', manager.core.get('chat-1')!.info.queue![0]!.id);
    await recorder.untilIdle();

    expect(claude.started).toHaveLength(1);
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['hello there']);
    expect(recorder.deltas).toBe('echo: hello there');
    const assistant = recorder.ofKind('assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({ text: 'echo: hello there', streaming: false });
    const turn = recorder.ofKind('turn')[0];
    expect(turn).toMatchObject({ state: 'done' });
    expect(turn?.endedAt).not.toBeNull();
    expect(assistant[0]?.turnId).toBe(turn?.id ?? '');
    expect(recorder.info).toMatchObject({
        model: 'claude-sonnet-5-5',
        slashCommands: ['compact', 'review'],
        usage: { turns: 1, costUsd: 0.01, contextWindow: 200000, contextTokens: 1110 }
    });
    expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
    expect(manager.core.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);
});

test('the name Claude Code wrote down for the session rides on the info once the turn ends', async () => {
    const asked: string[] = [];
    manager = await remake(manager, {
        claudeTitles: {
            forSession: async (agentSessionId) => {
                asked.push(agentSessionId);
                return 'Say hello';
            }
        }
    });
    await open(manager, 'chat-title');

    await manager.core.send('chat-title', 'hello there');
    await recorder.untilIdle();
    await recorder.until(() => recorder.info?.suggestedTitle === 'Say hello');
    expect(new Set(asked)).toEqual(new Set([recorder.info!.agentSessionId!]));
});

test('a permission request becomes an approval card, and allowing always sends the suggested rule', async () => {
    await open(manager, 'chat-2');
    await manager.core.send('chat-2', 'tool: date');
    await recorder.until(() => recorder.info?.status === 'needs-you');

    const approval = recorder.ofKind('approval')[0];
    expect(approval).toMatchObject({
        requestId: 'req-1',
        toolName: 'Bash',
        input: { command: 'date' },
        decision: 'pending',
        canAllowAlways: true,
        description: 'Run a command'
    });
    expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_1', name: 'Bash', state: 'running', output: null });

    expect(() => manager.core.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
    manager.core.approve('chat-2', 'req-1', 'allow-always');
    await recorder.untilIdle();
    expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
    expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date' });
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
});

test('a client that never attached still hears what a chat is waiting on', async () => {
    // The window has another view up, so nothing here reads the thread; the node still has to say it waits.
    const bystander = new ChatRecorder();
    manager.core.subscribe('c2', bystander.sink());
    await open(manager, 'chat-2a');

    await manager.core.send('chat-2a', 'tool: date');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'needs-you');
    expect(bystander.events).toEqual([]);
    expect(bystander.statuses.at(-1)).toMatchObject({ chatId: 'chat-2a', status: 'needs-you' });

    manager.core.approve('chat-2a', 'req-1', 'allow');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'idle');
    // One per change and never one per info event, or a streamed reply would announce itself all the way down.
    expect(bystander.statuses.map((info) => info.status)).toEqual(['running', 'needs-you', 'running', 'idle']);
});

test('what a chat waits on rides on its status, again whenever a request opens or settles', async () => {
    const bystander = new ChatRecorder();
    manager.core.subscribe('c2', bystander.sink());
    await open(manager, 'chat-2w');
    const waitingOn = () => bystander.statuses.at(-1)?.requests?.map((request) => request.requestId) ?? [];

    await manager.core.send('chat-2w', 'background approval: ls');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done');
    await bystander.until(() => waitingOn().join() === 'req-bg');
    expect(bystander.statuses.at(-1)?.requests?.[0]).toMatchObject({
        itemId: 'approval-req-bg',
        kind: 'approval',
        approval: { toolName: 'Bash', subject: 'ls', command: 'ls' }
    });

    // The chat already reads needs-you, so only the second request says anything changed.
    await manager.core.send('chat-2w', 'tool: date');
    await bystander.until(() => waitingOn().join() === 'req-bg,req-1');
    expect(
        manager.core
            .list()
            .find((info) => info.chatId === 'chat-2w')
            ?.requests?.map((request) => request.requestId)
    ).toEqual(['req-bg', 'req-1']);

    manager.core.approve('chat-2w', 'req-1', 'allow');
    await bystander.until(() => waitingOn().join() === 'req-bg');
    expect(bystander.statuses.at(-1)?.status).toBe('needs-you');

    manager.core.approve('chat-2w', 'req-bg', 'allow');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'idle');
    expect(bystander.statuses.at(-1)).not.toHaveProperty('requests');
});

test('a running tool carries the progress the CLI reports until its result arrives', async () => {
    await open(manager, 'chat-2b');
    const now = Date.UTC(2026, 9, 1);
    setSystemTime(now);
    await manager.core.send('chat-2b', 'run: sleep 30');
    await recorder.untilIdle();

    const running = recorder.events.filter((event) => event.type === 'item' && event.item.kind === 'tool' && event.item.state === 'running');
    const withProgress = running.map((event) => (event.type === 'item' && event.item.kind === 'tool' ? event.item.progress : undefined)).filter(Boolean);
    expect(withProgress.at(-1)).toMatchObject({ description: 'Run sleep 30', output: null });
    // The CLI said 30 seconds had passed, so the start lies 30 seconds before the moment the frame was read.
    expect(withProgress.at(-1)!.startedAt).toBe(now - 30_000);
    expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_run', state: 'done', output: 'ran: sleep 30' });
    expect(recorder.ofKind('tool')[0]).not.toHaveProperty('progress');
});

test('denying answers the CLI and the tool ends in error', async () => {
    await open(manager, 'chat-3');
    await manager.core.send('chat-3', 'tool: rm -rf /');
    await recorder.until(() => recorder.info?.status === 'needs-you');
    manager.core.approve('chat-3', 'req-1', 'deny', 'not that');
    await recorder.untilIdle();
    expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error', output: 'denied by user' });
});

test('a question to the person is answered by id and reaches the CLI by text', async () => {
    await open(manager, 'chat-q');
    await manager.core.send('chat-q', 'ask: Which color?');
    await recorder.until(() => recorder.info?.status === 'needs-you');
    const question = recorder.ofKind('question')[0];
    expect(question).toMatchObject({
        requestId: 'req-q',
        state: 'pending',
        questions: [{ id: '0', header: 'Choice', question: 'Which color?', multiSelect: false }]
    });
    expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

    expect(() => manager.core.answer('chat-q', 'nope', {})).toThrow('No question');
    manager.core.answer('chat-q', 'req-q', { '0': 'Blue' });
    await recorder.untilIdle();
    expect(recorder.ofKind('question')[0]).toMatchObject({ state: 'answered', answers: { '0': 'Blue' } });
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Blue']);
});

test('cancel interrupts a running turn and marks it aborted', async () => {
    const received = Promise.withResolvers<void>();
    claude = inProcess((io) => {
        const program = fakeClaude(io);
        return {
            onLine: (line) => {
                program.onLine(line);
                if (JSON.parse(line).type === 'user') {
                    received.resolve();
                }
            }
        };
    });
    manager = await remake(manager, { spawn: claude.spawn });
    await open(manager, 'chat-4');
    await manager.core.send('chat-4', 'slow');
    await received.promise;
    manager.core.cancel('chat-4');
    await recorder.untilIdle();
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['[interrupted]']);
    expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
});

test('configure restarts the CLI with new flags on the next send and keeps the session', async () => {
    await open(manager, 'chat-c');
    await manager.core.send('chat-c', 'first');
    await recorder.untilIdle();
    const sessionId = recorder.info?.agentSessionId;

    const info = manager.core.configure({
        chatId: 'chat-c',
        selection: { model: 'opus', options: { effort: 'max' } },
        runtimeMode: 'supervised'
    });
    expect(info).toMatchObject({
        selection: { model: 'claude-opus-5-5', options: { effort: 'max', contextWindow: '1m' } },
        runtimeMode: 'supervised',
        usage: { contextWindow: 1000000 }
    });
    // Configuring the same values again is a no-op, so it does not schedule another restart.
    expect(manager.core.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

    await manager.core.send('chat-c', 'argv?');
    await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
    expect(recorder.info?.agentSessionId).toBe(sessionId ?? null);
    expect(claude.started).toHaveLength(2);
    expect(await claude.started[0]!.exited).toBe(0);
    expect(claude.started[1]!.argv).toContain(`--resume=${sessionId!}`);
    // The fake reports the `--model` it was started with, so this proves the restart carried the new flags.
    expect(recorder.info?.model).toBe('claude-opus-5-5[1m]');
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: argv?']);
});

test('a restart ends the CLI between turns and the next send resumes the conversation in a fresh one', async () => {
    await open(manager, 'chat-r');
    await manager.core.send('chat-r', 'first');
    await recorder.untilIdle();
    const sessionId = recorder.info?.agentSessionId;

    await manager.core.restart('chat-r');
    expect(recorder.info).toMatchObject({ running: false, agentSessionId: sessionId });
    await claude.started[0]!.exited;

    await manager.core.send('chat-r', 'again');
    await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
    expect(claude.started).toHaveLength(2);
    expect(claude.started[1]!.argv).toContain(`--resume=${sessionId!}`);
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: again']);
});

test('a restart is refused while a turn runs', async () => {
    await open(manager, 'chat-busy');
    await manager.core.send('chat-busy', 'first');
    await expect(manager.core.restart('chat-busy')).rejects.toMatchObject({ code: 'chat-busy' });
    await recorder.untilIdle();
    expect(claude.started).toHaveLength(1);
});

test('the meter reads the window the pick asked for, not the maximum the CLI reports', async () => {
    await open(manager, 'chat-w', { selection: { model: 'opus', options: { contextWindow: '200k' } } });
    await manager.core.send('chat-w', 'hello');
    await recorder.untilIdle();
    // The CLI reports 1M whatever it was started on, and the turn it ends must not put that on the meter.
    expect(claude.started[0]!.argv).toContain('--model=claude-opus-5-5');
    expect(recorder.info?.usage.contextWindow).toBe(200_000);

    expect(manager.core.configure({ chatId: 'chat-w', selection: { model: 'opus', options: { contextWindow: '1m' } } })).toMatchObject({
        usage: { contextWindow: 1_000_000 }
    });
    const turns = recorder.info!.usage.turns;
    await manager.core.send('chat-w', 'after');
    await recorder.until(() => recorder.info?.usage.turns === turns + 1 && recorder.idle);
    expect(recorder.info?.model).toBe('claude-opus-5-5[1m]');
    expect(recorder.info?.usage.contextWindow).toBe(1_000_000);
});

test('a thread survives a new manager and the next send resumes the same CLI session', async () => {
    await open(manager, 'chat-5');
    await manager.core.send('chat-5', 'first');
    await recorder.untilIdle();
    const sessionId = recorder.info?.agentSessionId;
    // Shutdown persists every thread, so the manager built next reads it back.
    await manager.core.shutdown();

    const again = makeManager();
    const other = new ChatRecorder();
    again.core.subscribe('c9', other.sink());
    const info = await again.core.create({ chatId: 'chat-5' });
    expect(info).toMatchObject({ agentSessionId: sessionId, running: false, status: 'idle', usage: { turns: 1 } });
    expect(again.core.attach('chat-5', 'c9').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);

    void again.core.send('chat-5', 'second');
    await other.until(() => other.info?.status === 'idle' && other.info.running);
    expect(other.info?.agentSessionId).toBe(sessionId ?? null);
    expect(other.info?.usage.turns).toBe(2);
    await retire(again);
});

test('compaction shows up as a marker', async () => {
    await open(manager, 'chat-k');
    await manager.core.send('chat-k', 'compact');
    await recorder.untilIdle();
    expect(recorder.ofKind('compaction')[0]).toMatchObject({ preTokens: 5000 });
});

test('a turn carries its checkpoint and the diff of what it changed', async () => {
    const tree = 'a'.repeat(40);
    const diff: ChatCheckpointDiff = { files: [{ path: 'made.txt', kind: 'add', added: 1, deleted: 0, diff: '+hello\n' }], truncated: false };
    manager = await remake(manager, { checkpoints: new FakeCheckpoints(tree, diff) });

    await open(manager, 'chat-diff');
    await manager.core.send('chat-diff', 'write: made.txt hello');
    await recorder.until(() => recorder.idle && recorder.ofKind('turn')[0]?.checkpointDiff !== undefined);

    expect(await readFile(join(home, 'made.txt'), 'utf8')).toBe('hello\n');
    const turn = recorder.ofKind('turn')[0];
    expect(turn?.checkpoint).toBe(tree);
    expect(turn?.checkpointDiff).toEqual(diff);
    // turnDiff answers with the same diff already carried on the turn.
    expect(await manager.core.turnDiff('chat-diff', turn!.id)).toEqual(diff);
});
