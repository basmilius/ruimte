import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCheckpointDiff, ChatInfo, ChatItem, ChatSubagentItem, ContextSource } from '@ruimte/contracts';
import { VERBS_NOTE } from '../context/context-note.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder, FakeCheckpoints, RecordingStore } from './chat-test-helpers.ts';
import { fakeClaude } from './fake-claude.ts';
import { inProcess, type InProcessCli } from './fake-cli.ts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';

let home: string;
let store: RecordingStore;
let attachments: AttachmentStore;
let manager: ChatManager;
let recorder: ChatRecorder;
let claude: InProcessCli;

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const makeManager = (extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) =>
    new ChatManager({
        providers,
        store,
        attachments,
        spawn: claude.spawn,
        env: { PATH: process.env.PATH, HOME: home, RUIMTE_HOOK_URL: 'x' },
        ...extra
    });

// A chat's title timer and its CLI outlive a shutdown; only a dispose ends them.
const retire = async (target: ChatManager): Promise<void> => {
    await target.shutdown();
    for (const info of target.list()) {
        target.get(info.chatId)?.dispose();
    }
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-'));
    attachments = new AttachmentStore(home);
    store = new RecordingStore(home, attachments);
    claude = inProcess(fakeClaude);
    manager = makeManager();
    recorder = new ChatRecorder();
    manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

const idle = () => recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;

describe('ChatManager', () => {
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
            selection: { model: 'claude-sonnet-5', options: { effort: 'high', contextWindow: '200k' } },
            usage: { contextWindow: 200000 }
        });
        expect(manager.get('chat-1')?.running).toBe(false);
        expect(claude.started).toHaveLength(0);
        expect(manager.attach('chat-1', 'c1')).toEqual({ info, items: [], seq: 0 });

        await manager.send('chat-1', 'hello there');
        expect(manager.get('chat-1')?.running).toBe(true);
        // A send while the turn runs queues instead of failing; this test wants the queue empty again.
        expect(await manager.send('chat-1', 'again')).toEqual({ queued: true });
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
            model: 'claude-sonnet-5',
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

    test('a running tool carries the progress the CLI reports until its result arrives', async () => {
        await manager.create({ chatId: 'chat-2b', cwd: home });
        manager.attach('chat-2b', 'c1');
        const before = Date.now();
        await manager.send('chat-2b', 'run: sleep 30');
        await recorder.until(idle);
        const after = Date.now();

        const running = recorder.events.filter((event) => event.type === 'item' && event.item.kind === 'tool' && event.item.state === 'running');
        const withProgress = running.map((event) => (event.type === 'item' && event.item.kind === 'tool' ? event.item.progress : undefined)).filter(Boolean);
        expect(withProgress.at(-1)).toMatchObject({ description: 'Run sleep 30', output: null });
        // The CLI said 30 seconds had passed, so the start lies 30 seconds before the moment the frame was read.
        expect(withProgress.at(-1)!.startedAt).toBeGreaterThanOrEqual(before - 30_000);
        expect(withProgress.at(-1)!.startedAt).toBeLessThanOrEqual(after - 30_000);
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
        await manager.create({ chatId: 'chat-4', cwd: home });
        manager.attach('chat-4', 'c1');
        await manager.send('chat-4', 'slow');
        await recorder.until(() => recorder.info?.running === true);
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
            selection: { model: 'claude-opus-5', options: { effort: 'max', contextWindow: '1m' } },
            runtimeMode: 'supervised',
            usage: { contextWindow: 1000000 }
        });
        // Same again is a no-op and does not schedule a restart.
        expect(manager.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

        await manager.send('chat-c', 'argv?');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(recorder.info?.agentSessionId).toBe(sessionId ?? null);
        expect(claude.started).toHaveLength(2);
        expect(await claude.started[0]!.exited).toBe(0);
        const argv = claude.started[1]!.argv;
        expect(argv[argv.indexOf('--resume') + 1]).toBe(sessionId!);
        // The fake reports the `--model` it was started with, so this proves the restart carried the new flags.
        expect(recorder.info?.model).toBe('claude-opus-5[1m]');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: argv?']);
    });

    test('a thread survives a new manager and the next send resumes the same CLI session', async () => {
        await manager.create({ chatId: 'chat-5', cwd: home });
        manager.attach('chat-5', 'c1');
        await manager.send('chat-5', 'first');
        await recorder.until(idle);
        const sessionId = recorder.info?.agentSessionId;
        // Shutting down writes every thread and waits for it.
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

    test('the system prompt names the verbs always and the links only when there are some', async () => {
        await manager.create({ chatId: 'chat-sys', cwd: home });
        manager.attach('chat-sys', 'c1');
        await manager.send('chat-sys', 'system?');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(VERBS_NOTE);

        await retire(manager);
        manager = makeManager({ hasContext: () => true });
        const linked = new ChatRecorder();
        manager.subscribe('c2', linked.sink());
        await manager.create({ chatId: 'chat-sys-2', cwd: home });
        manager.attach('chat-sys-2', 'c2');
        await manager.send('chat-sys-2', 'system?');
        await linked.until(() => linked.ofKind('assistant').length === 1 && linked.info?.activeTurnId === null);
        expect(linked.ofKind('assistant')[0]?.text).toStartWith(`${VERBS_NOTE} The person linked context to this chat on their canvas.`);
    });

    test('a link made between turns is put in front of the next prompt, once, as a note', async () => {
        let sources: ContextSource[] = [];
        await retire(manager);
        manager = makeManager({ contextSources: () => sources });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-ctx', cwd: home });
        manager.attach('chat-ctx', 'c1');

        await manager.send('chat-ctx', 'first');
        await recorder.until(idle);
        sources = [{ id: 'term-1', kind: 'terminal', title: 'dev server' }];
        await manager.send('chat-ctx', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        await manager.send('chat-ctx', 'third');
        await recorder.until(() => recorder.info?.usage.turns === 3 && idle());

        const notes = recorder.ofKind('note');
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ level: 'info', turnId: recorder.ofKind('turn')[1]?.turnId });
        expect(notes[0]?.text).toContain('Added: "dev server" (terminal)');
        // The fake echoes its prompt, so the reply shows what the CLI was given.
        const replies = recorder.ofKind('assistant').map((item) => item.text);
        expect(replies[0]).toBe('echo: first');
        expect(replies[1]).toBe(`echo: ${notes[0]?.text}\n\nsecond`);
        expect(replies[2]).toBe('echo: third');
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['first', 'second', 'third']);
    });

    test('a CLI that dies mid-turn leaves an error note and the chat can go on', async () => {
        await manager.create({ chatId: 'chat-6', cwd: home });
        manager.attach('chat-6', 'c1');
        await manager.send('chat-6', 'crash');
        await recorder.until(() => recorder.info?.running === false && recorder.info.status === 'error');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');

        await manager.send('chat-6', 'again');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again']);
        expect(claude.started).toHaveLength(2);
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
        // The same answer over the request.
        expect(await manager.turnDiff('chat-diff', turn!.id)).toEqual(diff);
    });

    test('a background subagent that settles opens a turn of the agent, with the summary as its label', async () => {
        await manager.create({ chatId: 'chat-bg', cwd: home });
        manager.attach('chat-bg', 'c1');
        await manager.send('chat-bg', 'background: report written');
        await recorder.until(idle);
        expect(recorder.ofKind('turn')).toHaveLength(1);

        // Nothing is sent from here: the CLI wakes the agent itself once the task settles.
        claude.started[0]!.runLater();
        await recorder.until(() => recorder.ofKind('turn').length === 2);
        const agentTurn = recorder.ofKind('turn')[1]!;
        expect(agentTurn).toMatchObject({ origin: 'agent', label: 'report written' });
        expect(recorder.events.some((event) => event.type === 'item' && event.item.id === agentTurn.id && event.item.kind === 'turn')).toBe(true);
        expect(recorder.events.some((event) => event.type === 'info' && event.info.activeTurnId === agentTurn.id && event.info.status === 'running')).toBe(
            true
        );

        const settled = (): boolean => {
            const turn = recorder.items.get(agentTurn.id);
            return turn?.kind === 'turn' && turn.state === 'done';
        };
        await recorder.until(settled);
        expect(recorder.items.get(agentTurn.id)).toMatchObject({ state: 'done', endedAt: expect.any(Number) });
        expect(idle()).toBe(true);
        // The person wrote one message; the second turn has none and carries the agent's own answer.
        expect(recorder.ofKind('user')).toHaveLength(1);
        const answers = recorder.ofKind('assistant').filter((item) => !item.parentToolUseId);
        expect(answers.map((item) => item.text)).toEqual(['I will report back', 'the subagent says: report written']);
        expect(answers[1]?.turnId).toBe(agentTurn.id);

        // The subagent has a row of its own: its work, its report and what it spent.
        const subagent = recorder.ofKind('subagent')[0]!;
        expect(subagent).toMatchObject({
            toolUseId: 'toolu_agent',
            description: 'report written',
            subagentType: 'general-purpose',
            background: true,
            status: 'done',
            summary: 'report written',
            result: 'the subagent says: report written',
            usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 }
        });
        expect(agentTurn.taskToolUseId).toBe('toolu_agent');
        const children = [...recorder.items.values()].filter((item) => item.kind === 'tool' && item.parentToolUseId === 'toolu_agent');
        expect(children.map((item) => (item.kind === 'tool' ? item.name : ''))).toEqual(['Read', 'Bash']);
        // A subagent's work belongs to the turn its row sits in, not to the turn that woke the agent.
        expect(children.every((item) => item.turnId === subagent.turnId)).toBe(true);
    });

    test('a foreground subagent settles from its own call, without the footer the CLI appends', async () => {
        await manager.create({ chatId: 'chat-delegate', cwd: home });
        manager.attach('chat-delegate', 'c1');
        await manager.send('chat-delegate', 'delegate: read the readme');
        await recorder.until(idle);

        const subagent = recorder.ofKind('subagent')[0]!;
        expect(subagent).toMatchObject({
            toolUseId: 'toolu_delegate',
            description: 'read the readme',
            subagentType: 'general-purpose',
            prompt: 'Do this: read the readme',
            background: false,
            status: 'done',
            result: '# Report\n\n- one\n- two',
            lastTool: 'Bash',
            usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 },
            itemsTruncated: false
        });
        expect(recorder.ofKind('tool').filter((item) => item.parentToolUseId === 'toolu_delegate')).toHaveLength(2);
        // The delegation is a subagent row, so it is not a tool row as well.
        expect(recorder.ofKind('tool').some((item) => item.name === 'Agent')).toBe(false);
    });

    test('the record holds a turn while it is still running', async () => {
        await manager.create({ chatId: 'chat-open', cwd: home });
        manager.attach('chat-open', 'c1');
        await manager.send('chat-open', 'slow');
        await store.written('chat-open', (record) => record.items.some((item) => item.kind === 'turn' && item.state === 'running'));

        const stored = await store.read('chat-open');
        expect(stored?.items.map((item) => item.kind)).toEqual(['turn', 'user']);
        expect(stored?.info.activeTurnId).not.toBeNull();
        manager.cancel('chat-open');
        await recorder.until(idle);
    });

    test('kill drops the thread and its record', async () => {
        await manager.create({ chatId: 'chat-7', cwd: home });
        manager.attach('chat-7', 'c1');
        await manager.send('chat-7', 'x');
        await recorder.until(idle);
        // The write the settled turn asked for is the last one; a kill before it lands would race it.
        await store.written('chat-7', (record) => record.info.activeTurnId === null && record.items.some((item) => item.kind === 'turn'));
        await manager.kill('chat-7');
        expect(manager.list()).toEqual([]);
        expect(await store.read('chat-7')).toBeNull();
        expect(() => manager.send('chat-7', 'x')).toThrow('No chat');
    });

    test('messages sent during a turn queue in order and go out when it settles', async () => {
        await manager.create({ chatId: 'chat-q', cwd: home });
        manager.attach('chat-q', 'c1');
        expect(await manager.send('chat-q', 'first')).toEqual({ queued: false });
        expect(await manager.send('chat-q', 'second')).toEqual({ queued: true });
        expect(await manager.send('chat-q', 'third')).toEqual({ queued: true });
        expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['second', 'third']);

        await recorder.until(() => recorder.ofKind('user').length === 3 && idle());
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['first', 'second', 'third']);
        expect(recorder.info?.queue).toEqual([]);
    });

    test('a queued message can be dropped, and the queue survives a reload', async () => {
        await manager.create({ chatId: 'chat-q2', cwd: home });
        manager.attach('chat-q2', 'c1');
        // A turn that waits for an interrupt keeps the queue from draining while the test looks at it.
        await manager.send('chat-q2', 'slow');
        await manager.send('chat-q2', 'dropped');
        await manager.send('chat-q2', 'kept');
        const queue = recorder.info!.queue!;
        manager.unqueue('chat-q2', queue[0]!.id);
        expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['kept']);
        expect(() => manager.unqueue('chat-q2', queue[0]!.id)).toThrow('No queued message');

        // A daemon that goes down mid-turn must not lose what was waiting behind it.
        await store.written('chat-q2', (record) => (record.info.queue ?? []).map((message) => message.text).join() === 'kept');
        manager.get('chat-q2')?.dispose();
        const reloaded = makeManager();
        expect((await reloaded.create({ chatId: 'chat-q2' })).queue?.map((message) => message.text)).toEqual(['kept']);
        await retire(reloaded);
    });

    test('send now stops the running turn and puts that message first', async () => {
        await manager.create({ chatId: 'chat-q3', cwd: home });
        manager.attach('chat-q3', 'c1');
        await manager.send('chat-q3', 'slow');
        await manager.send('chat-q3', 'waiting');
        await manager.send('chat-q3', 'urgent');
        const urgent = recorder.info!.queue!.find((message) => message.text === 'urgent')!;
        manager.sendNow('chat-q3', urgent.id);

        await recorder.until(() => recorder.ofKind('user').length === 3);
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['slow', 'urgent', 'waiting']);
    });
});

describe('clearing a chat', () => {
    test('empties the thread on disk and the next send starts the CLI without resuming', async () => {
        await manager.create({ chatId: 'chat-clear', cwd: home, selection: { model: 'opus', options: {} } });
        manager.attach('chat-clear', 'c1');
        await manager.send('chat-clear', 'first');
        await recorder.until(idle);
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
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(claude.started.at(-1)!.argv).not.toContain('--resume');
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.info?.agentSessionId).not.toBe(first.agentSessionId);
        expect(manager.attach('chat-clear', 'c1').items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['second']);
    });

    test('a running turn is refused without force; with force the CLI goes and nothing of the turn comes back', async () => {
        const diff: ChatCheckpointDiff = { files: [{ path: 'seed.txt', kind: 'update', added: 1, deleted: 1, diff: '-seed\n+other\n' }], truncated: false };
        const checkpoints = new FakeCheckpoints('b'.repeat(40), diff);
        await retire(manager);
        manager = makeManager({ checkpoints });
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-busy', cwd: home });
        manager.attach('chat-busy', 'c1');
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
        expect(await claude.started[0]!.exited).toBeNull();
        await checkpoints.settled();
        expect(recorder.items.size).toBe(0);
        expect(manager.attach('chat-busy', 'c1').items).toEqual([]);
        expect((await store.read('chat-busy'))?.items).toEqual([]);
    });
});

describe('the first prompt of an agent node', () => {
    const withPrompt = (prompt: string | null) => {
        let left = prompt;
        const taken = () =>
            makeManager({
                firstPrompt: async () => {
                    const value = left;
                    left = null;
                    return value;
                }
            });
        return { taken, left: () => left };
    };

    const settledIn = (chatId: string) => (): boolean => manager.get(chatId)?.info.activeTurnId === null && manager.get(chatId)?.info.running === true;

    const threadOf = (chatId: string) => manager.get(chatId)!.thread.list();

    test('becomes the first message of the thread, so the person reads it as one', async () => {
        const held = withPrompt('start on the parser');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const info = await manager.create({ chatId: 'chat-p', cwd: home });
        // The prompt is in the thread before create answers, so an attach right after it shows the turn.
        const items = manager.attach('chat-p', 'c1').items;
        expect(items.filter((item) => item.kind === 'user').map((item) => item.kind === 'user' && item.text)).toEqual(['start on the parser']);
        expect(info.chatId).toBe('chat-p');
        await recorder.until(settledIn('chat-p'));
        expect(
            threadOf('chat-p')
                .filter((item) => item.kind === 'assistant')
                .map((item) => item.kind === 'assistant' && item.text)
        ).toEqual(['echo: start on the parser']);
        expect(held.left()).toBeNull();
    });

    test('a second create of the same chat sends nothing again', async () => {
        const held = withPrompt('only once');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const userTexts = () =>
            threadOf('chat-p')
                .filter((item) => item.kind === 'user')
                .map((item) => item.text);
        await manager.create({ chatId: 'chat-p', cwd: home });
        manager.attach('chat-p', 'c1');
        await recorder.until(settledIn('chat-p'));
        expect(userTexts()).toEqual(['only once']);

        // The client of a second window mounts the same node; the prompt is gone, so nothing is sent.
        await manager.create({ chatId: 'chat-p', cwd: home });
        expect(userTexts()).toEqual(['only once']);
        expect(held.left()).toBeNull();
        expect(claude.started).toHaveLength(1);
    });

    test('two creates at once, the machine starting the node and a client mounting it, send it once to one chat', async () => {
        const held = withPrompt('only once');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const [started, mounted] = await Promise.all([manager.create({ chatId: 'chat-r', cwd: home }), manager.create({ chatId: 'chat-r', cwd: home })]);
        expect(mounted).toBe(started);
        // The mount waited for the whole create, so what it attaches to already carries the prompt.
        expect(
            manager
                .attach('chat-r', 'c1')
                .items.filter((item) => item.kind === 'user')
                .map((item) => item.kind === 'user' && item.text)
        ).toEqual(['only once']);
        await recorder.until(settledIn('chat-r'));
        expect(claude.started).toHaveLength(1);
    });

    test('a kill that arrives while the chat is being made ends the chat that was made', async () => {
        await retire(manager);
        manager = withPrompt('go').taken();
        const creating = manager.create({ chatId: 'chat-s', cwd: home });
        const killed = manager.kill('chat-s');
        await creating;
        await killed;
        expect(manager.get('chat-s')).toBeUndefined();
    });

    test('without a prompt, create still spawns nothing', async () => {
        await retire(manager);
        manager = withPrompt(null).taken();
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-q', cwd: home });
        expect(manager.get('chat-q')?.running).toBe(false);
        expect(claude.started).toHaveLength(0);
    });
});

describe('the conversation of a Claude subagent', () => {
    const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';
    const FIXTURE = join(import.meta.dir, 'fixtures', 'claude-projects');

    test('is read beside the session with no CLI running, notes its agent on the row, and lets go with the socket', async () => {
        await retire(manager);
        const watch = new FakeWatch();
        manager = makeManager({ subagents: { claudeProjectsDir: FIXTURE, seams: watch } });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-sub', cwd: '/work/demo', resume: SESSION });
        manager.attach('chat-sub', 'c1');
        const session = manager.get('chat-sub')!;
        session.thread.upsert({
            id: '1:toolu_01ParentAgentCall',
            kind: 'subagent',
            createdAt: 1,
            turnId: null,
            toolUseId: 'toolu_01ParentAgentCall',
            description: 'Survey the docs',
            subagentType: 'general-purpose',
            prompt: null,
            background: false,
            status: 'done',
            startedAt: 1,
            finishedAt: 2,
            summary: null,
            result: null,
            usage: null,
            lastTool: null,
            itemsTruncated: false
        });

        const page = await manager.subagent('c1', { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall', watch: true });
        expect(page).toMatchObject({ source: 'claude-transcript', live: false });
        expect(page.items.at(-1)).toMatchObject({ kind: 'assistant' });
        expect(claude.started).toHaveLength(0);
        await recorder.until(() => recorder.ofKind('subagent')[0]?.native?.agentId === 'a4c2e8f10b3d5a7e9');

        const dir = join(FIXTURE, '-work-demo', SESSION, 'subagents');
        const watcher = watch.on(dir);
        watcher.emit('agent-a4c2e8f10b3d5a7e9.jsonl');
        const told: unknown[] = [];
        manager.subscribe('c1', (event) => told.push(event));
        await watch.settle();
        expect(told).toEqual([{ event: 'chat.subagentChanged', payload: { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall' } }]);

        manager.detachAll('c1');
        expect(watcher.closed).toBe(true);
    });
});

describe('a background subagent whose CLI is gone', () => {
    const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';
    const FIXTURE = join(import.meta.dir, 'fixtures', 'claude-projects');
    const CALL = 'toolu_01ChildAgentCall';

    const runningRow = (toolUseId: string, id = `1:${toolUseId}`): ChatSubagentItem => ({
        id,
        kind: 'subagent',
        createdAt: 1,
        turnId: 'turn-1',
        toolUseId,
        description: 'Count the headings',
        subagentType: 'general-purpose',
        prompt: null,
        background: true,
        status: 'running',
        startedAt: 1,
        finishedAt: null,
        summary: 'Running grep',
        result: null,
        usage: null,
        lastTool: 'Bash',
        itemsTruncated: false
    });

    const storedInfo = (chatId: string, provider: ChatInfo['provider']): ChatInfo => ({
        chatId,
        provider,
        cwd: '/work/demo',
        agentSessionId: SESSION,
        model: null,
        selection: { model: 'claude-opus-5', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 1 },
        createdAt: 1
    });

    const rowOf = (target: ChatManager, chatId: string, toolUseId: string): ChatItem | undefined =>
        target.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);

    let projects: string;

    beforeEach(async () => {
        projects = join(home, 'claude-projects');
        await cp(FIXTURE, projects, { recursive: true });
    });

    test('settles as done on load when its transcript shows the end, which the next load keeps', async () => {
        await store.write('chat-stale', storedInfo('chat-stale', 'claude'), [runningRow(CALL)]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-stale' });
        expect(rowOf(manager, 'chat-stale', CALL)).toMatchObject({
            status: 'done',
            finishedAt: Date.parse('2026-09-16T08:58:39.000Z'),
            result: 'There are 42 headings.'
        });
        await manager.shutdown();
        expect((await store.read('chat-stale'))?.items.find((item) => item.kind === 'subagent')).toMatchObject({ status: 'done' });
    });

    test('stays running on load while its transcript ends mid tool call, and settles when a read finds the end', async () => {
        const transcript = join(projects, '-work-demo', SESSION, 'subagents', 'agent-a9b8c7d6e5f4a3b21.jsonl');
        const finished = await readFile(transcript, 'utf8');
        const lines = finished.trimEnd().split('\n');
        const toolCall = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:58:31.000Z',
            message: { id: 'msg_more', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_more', name: 'Bash', input: {} }], stop_reason: 'tool_use' }
        });
        await writeFile(transcript, `${[...lines, toolCall].join('\n')}\n`);
        await store.write('chat-working', storedInfo('chat-working', 'claude'), [runningRow(CALL)]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-working' });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'running', finishedAt: null });

        const answer = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:59:00.000Z',
            message: { id: 'msg_last', role: 'assistant', content: [{ type: 'text', text: 'Still 42.' }], stop_reason: 'end_turn' }
        });
        await appendFile(transcript, `${answer}\n`);
        await manager.subagent('c1', { chatId: 'chat-working', toolUseId: CALL });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'done', finishedAt: Date.parse('2026-09-16T08:59:00.000Z'), result: 'Still 42.' });
    });

    test('a Codex agent was running inside the app-server that went down, so a load settles it as failed', async () => {
        await store.write('chat-codex', storedInfo('chat-codex', 'codex'), [{ ...runningRow('collab_1'), native: { threadId: 'child-1' } }]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-codex' });
        expect(rowOf(manager, 'chat-codex', 'collab_1')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
    });

    test('a CLI that exits before its notification leaves the row done when the transcript shows the end, failed otherwise', async () => {
        const subagents = join(projects, '-work-demo', SESSION, 'subagents');
        await writeFile(join(subagents, 'agent-afake.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_agent' }));
        await writeFile(
            join(subagents, 'agent-afake.jsonl'),
            `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T09:00:00.000Z', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'All written.' }], stop_reason: 'end_turn' } })}\n`
        );
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-exit', cwd: '/work/demo', resume: SESSION });
        manager.attach('chat-exit', 'c1');
        await manager.send('chat-exit', 'background: report written');
        await recorder.until(idle);
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject({ status: 'running' });

        // The CLI goes before the work it put off ever runs, so no notification comes.
        void manager.send('chat-exit', 'crash').catch(() => undefined);
        await claude.started[0]!.exited;
        await recorder.until(() => recorder.ofKind('subagent')[0]?.status === 'done');
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject({
            status: 'done',
            result: 'All written.',
            finishedAt: Date.parse('2026-09-16T09:00:00.000Z')
        });
    });
});
