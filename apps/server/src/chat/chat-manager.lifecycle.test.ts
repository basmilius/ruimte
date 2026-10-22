import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { ChatRecorder, FakeCheckpoints } from './chat-test-helpers.ts';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import { makeChatFixture, retire } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
function idle() {
    return recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;
}
beforeEach(async () => {
    ({ home, claude, manager, recorder, makeManager } = await makeChatFixture());
});
afterEach(async () => {
    setSystemTime();
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('create spawns nothing; the first send starts the CLI with the selection and streams a reply', async () => {
    const info = await manager.create({ chatId: 'chat-1', cwd: home });
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
    expect(manager.get('chat-1')?.running).toBe(false);
    expect(claude.started).toHaveLength(0);
    expect(manager.attach('chat-1', 'c1')).toEqual({ info, items: [], seq: 0 });

    await manager.send('chat-1', 'hello there');
    expect(manager.get('chat-1')?.running).toBe(true);
    // A send while a turn runs queues instead of failing, so the test unqueues it to reach idle.
    expect(await manager.send('chat-1', 'again')).toMatchObject({ queued: true });
    manager.unqueue('chat-1', manager.get('chat-1')!.info.queue![0]!.id);
    await recorder.until(idle);

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
    expect(manager.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);
});

test('the name Claude Code wrote down for the session rides on the info once the turn ends', async () => {
    const asked: string[] = [];
    await retire(manager);
    manager = makeManager({
        claudeTitles: {
            forSession: async (agentSessionId) => {
                asked.push(agentSessionId);
                return 'Say hello';
            }
        }
    });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-title', cwd: home });
    manager.attach('chat-title', 'c1');

    await manager.send('chat-title', 'hello there');
    await recorder.until(idle);
    await recorder.until(() => recorder.info?.suggestedTitle === 'Say hello');
    expect(new Set(asked)).toEqual(new Set([recorder.info!.agentSessionId!]));
});

test('a permission request becomes an approval card, and allowing always sends the suggested rule', async () => {
    await manager.create({ chatId: 'chat-2', cwd: home });
    manager.attach('chat-2', 'c1');
    await manager.send('chat-2', 'tool: date');
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

    expect(() => manager.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
    manager.approve('chat-2', 'req-1', 'allow-always');
    await recorder.until(idle);
    expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
    expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date' });
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
});

test('a client that never attached still hears what a chat is waiting on', async () => {
    // The window has another view up, so nothing here reads the thread; the node still has to say it waits.
    const bystander = new ChatRecorder();
    manager.subscribe('c2', bystander.sink());
    await manager.create({ chatId: 'chat-2a', cwd: home });
    manager.attach('chat-2a', 'c1');

    await manager.send('chat-2a', 'tool: date');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'needs-you');
    expect(bystander.events).toEqual([]);
    expect(bystander.statuses.at(-1)).toMatchObject({ chatId: 'chat-2a', status: 'needs-you' });

    manager.approve('chat-2a', 'req-1', 'allow');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'idle');
    // One per change and never one per info event, or a streamed reply would announce itself all the way down.
    expect(bystander.statuses.map((info) => info.status)).toEqual(['running', 'needs-you', 'running', 'idle']);
});

test('what a chat waits on rides on its status, again whenever a request opens or settles', async () => {
    const bystander = new ChatRecorder();
    manager.subscribe('c2', bystander.sink());
    await manager.create({ chatId: 'chat-2w', cwd: home });
    manager.attach('chat-2w', 'c1');
    const waitingOn = () => bystander.statuses.at(-1)?.requests?.map((request) => request.requestId) ?? [];

    await manager.send('chat-2w', 'background approval: ls');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done');
    await bystander.until(() => waitingOn().join() === 'req-bg');
    expect(bystander.statuses.at(-1)?.requests?.[0]).toMatchObject({
        itemId: 'approval-req-bg',
        kind: 'approval',
        approval: { toolName: 'Bash', subject: 'ls', command: 'ls' }
    });

    // The chat already reads needs-you, so only the second request says anything changed.
    await manager.send('chat-2w', 'tool: date');
    await bystander.until(() => waitingOn().join() === 'req-bg,req-1');
    expect(
        manager
            .list()
            .find((info) => info.chatId === 'chat-2w')
            ?.requests?.map((request) => request.requestId)
    ).toEqual(['req-bg', 'req-1']);

    manager.approve('chat-2w', 'req-1', 'allow');
    await bystander.until(() => waitingOn().join() === 'req-bg');
    expect(bystander.statuses.at(-1)?.status).toBe('needs-you');

    manager.approve('chat-2w', 'req-bg', 'allow');
    await bystander.until(() => bystander.statuses.at(-1)?.status === 'idle');
    expect(bystander.statuses.at(-1)).not.toHaveProperty('requests');
});

test('a running tool carries the progress the CLI reports until its result arrives', async () => {
    await manager.create({ chatId: 'chat-2b', cwd: home });
    manager.attach('chat-2b', 'c1');
    const now = Date.UTC(2026, 9, 1);
    setSystemTime(now);
    await manager.send('chat-2b', 'run: sleep 30');
    await recorder.until(idle);

    const running = recorder.events.filter((event) => event.type === 'item' && event.item.kind === 'tool' && event.item.state === 'running');
    const withProgress = running.map((event) => (event.type === 'item' && event.item.kind === 'tool' ? event.item.progress : undefined)).filter(Boolean);
    expect(withProgress.at(-1)).toMatchObject({ description: 'Run sleep 30', output: null });
    // The CLI said 30 seconds had passed, so the start lies 30 seconds before the moment the frame was read.
    expect(withProgress.at(-1)!.startedAt).toBe(now - 30_000);
    expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_run', state: 'done', output: 'ran: sleep 30' });
    expect(recorder.ofKind('tool')[0]).not.toHaveProperty('progress');
});

test('denying answers the CLI and the tool ends in error', async () => {
    await manager.create({ chatId: 'chat-3', cwd: home });
    manager.attach('chat-3', 'c1');
    await manager.send('chat-3', 'tool: rm -rf /');
    await recorder.until(() => recorder.info?.status === 'needs-you');
    manager.approve('chat-3', 'req-1', 'deny', 'not that');
    await recorder.until(idle);
    expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error', output: 'denied by user' });
});

test('a question to the person is answered by id and reaches the CLI by text', async () => {
    await manager.create({ chatId: 'chat-q', cwd: home });
    manager.attach('chat-q', 'c1');
    await manager.send('chat-q', 'ask: Which color?');
    await recorder.until(() => recorder.info?.status === 'needs-you');
    const question = recorder.ofKind('question')[0];
    expect(question).toMatchObject({
        requestId: 'req-q',
        state: 'pending',
        questions: [{ id: '0', header: 'Choice', question: 'Which color?', multiSelect: false }]
    });
    expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

    expect(() => manager.answer('chat-q', 'nope', {})).toThrow('No question');
    manager.answer('chat-q', 'req-q', { '0': 'Blue' });
    await recorder.until(idle);
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
    await retire(manager);
    manager = makeManager({ spawn: claude.spawn });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-4', cwd: home });
    manager.attach('chat-4', 'c1');
    await manager.send('chat-4', 'slow');
    await received.promise;
    manager.cancel('chat-4');
    await recorder.until(idle);
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['[interrupted]']);
    expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
});

test('configure restarts the CLI with new flags on the next send and keeps the session', async () => {
    await manager.create({ chatId: 'chat-c', cwd: home });
    manager.attach('chat-c', 'c1');
    await manager.send('chat-c', 'first');
    await recorder.until(idle);
    const sessionId = recorder.info?.agentSessionId;

    const info = manager.configure({
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
    expect(manager.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

    await manager.send('chat-c', 'argv?');
    await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
    expect(recorder.info?.agentSessionId).toBe(sessionId ?? null);
    expect(claude.started).toHaveLength(2);
    expect(await claude.started[0]!.exited).toBe(0);
    const argv = claude.started[1]!.argv;
    expect(argv[argv.indexOf('--resume') + 1]).toBe(sessionId!);
    // The fake reports the `--model` it was started with, so this proves the restart carried the new flags.
    expect(recorder.info?.model).toBe('claude-opus-5-5[1m]');
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: argv?']);
});

test('a restart ends the CLI between turns and the next send resumes the conversation in a fresh one', async () => {
    await manager.create({ chatId: 'chat-r', cwd: home });
    manager.attach('chat-r', 'c1');
    await manager.send('chat-r', 'first');
    await recorder.until(idle);
    const sessionId = recorder.info?.agentSessionId;

    await manager.restart('chat-r');
    expect(recorder.info).toMatchObject({ running: false, agentSessionId: sessionId });
    await claude.started[0]!.exited;

    await manager.send('chat-r', 'again');
    await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
    expect(claude.started).toHaveLength(2);
    const argv = claude.started[1]!.argv;
    expect(argv[argv.indexOf('--resume') + 1]).toBe(sessionId!);
    expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: again']);
});

test('a restart is refused while a turn runs', async () => {
    await manager.create({ chatId: 'chat-busy', cwd: home });
    manager.attach('chat-busy', 'c1');
    await manager.send('chat-busy', 'first');
    await expect(manager.restart('chat-busy')).rejects.toMatchObject({ code: 'chat-busy' });
    await recorder.until(idle);
    expect(claude.started).toHaveLength(1);
});

test('the meter reads the window the pick asked for, not the maximum the CLI reports', async () => {
    await manager.create({ chatId: 'chat-w', cwd: home, selection: { model: 'opus', options: { contextWindow: '200k' } } });
    manager.attach('chat-w', 'c1');
    await manager.send('chat-w', 'hello');
    await recorder.until(idle);
    // The CLI reports 1M whatever it was started on, and the turn it ends must not put that on the meter.
    const argv = claude.started[0]!.argv;
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(recorder.info?.usage.contextWindow).toBe(200_000);

    expect(manager.configure({ chatId: 'chat-w', selection: { model: 'opus', options: { contextWindow: '1m' } } })).toMatchObject({
        usage: { contextWindow: 1_000_000 }
    });
    const turns = recorder.info!.usage.turns;
    await manager.send('chat-w', 'after');
    await recorder.until(() => recorder.info?.usage.turns === turns + 1 && idle());
    expect(recorder.info?.model).toBe('claude-opus-5-5[1m]');
    expect(recorder.info?.usage.contextWindow).toBe(1_000_000);
});

test('a thread survives a new manager and the next send resumes the same CLI session', async () => {
    await manager.create({ chatId: 'chat-5', cwd: home });
    manager.attach('chat-5', 'c1');
    await manager.send('chat-5', 'first');
    await recorder.until(idle);
    const sessionId = recorder.info?.agentSessionId;
    // Shutdown persists every thread, so the manager built next reads it back.
    await manager.shutdown();

    const again = makeManager();
    const other = new ChatRecorder();
    again.subscribe('c9', other.sink());
    const info = await again.create({ chatId: 'chat-5' });
    expect(info).toMatchObject({ agentSessionId: sessionId, running: false, status: 'idle', usage: { turns: 1 } });
    expect(again.attach('chat-5', 'c9').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);

    void again.send('chat-5', 'second');
    await other.until(() => other.info?.status === 'idle' && other.info.running);
    expect(other.info?.agentSessionId).toBe(sessionId ?? null);
    expect(other.info?.usage.turns).toBe(2);
    await retire(again);
});

test('compaction shows up as a marker', async () => {
    await manager.create({ chatId: 'chat-k', cwd: home });
    manager.attach('chat-k', 'c1');
    await manager.send('chat-k', 'compact');
    await recorder.until(idle);
    expect(recorder.ofKind('compaction')[0]).toMatchObject({ preTokens: 5000 });
});

test('a turn carries its checkpoint and the diff of what it changed', async () => {
    const tree = 'a'.repeat(40);
    const diff: ChatCheckpointDiff = { files: [{ path: 'made.txt', kind: 'add', added: 1, deleted: 0, diff: '+hello\n' }], truncated: false };
    await retire(manager);
    manager = makeManager({ checkpoints: new FakeCheckpoints(tree, diff) });
    manager.subscribe('c1', recorder.sink());

    await manager.create({ chatId: 'chat-diff', cwd: home });
    manager.attach('chat-diff', 'c1');
    await manager.send('chat-diff', 'write: made.txt hello');
    await recorder.until(() => idle() && recorder.ofKind('turn')[0]?.checkpointDiff !== undefined);

    expect(await readFile(join(home, 'made.txt'), 'utf8')).toBe('hello\n');
    const turn = recorder.ofKind('turn')[0];
    expect(turn?.checkpoint).toBe(tree);
    expect(turn?.checkpointDiff).toEqual(diff);
    // turnDiff answers with the same diff already carried on the turn.
    expect(await manager.turnDiff('chat-diff', turn!.id)).toEqual(diff);
});
