import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatBookmark, ChatCheckpointDiff, ChatInfo, ChatItem, ChatSubagentItem, ContextSource } from '@ruimte/contracts';
import { chatPrompt, verbsNote } from '../context/context-note.ts';
import { deliverNotice, noticeNote, NoticeStore, renderNotice, showNotices, type Notice } from '../context/notices.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { AttachmentStore } from './attachment-store.ts';
import { BookmarkStore } from './bookmark-store.ts';
import { chatReferenceNote } from '../context/chat-references.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder, FakeCheckpoints, RecordingStore } from './chat-test-helpers.ts';
import { fakeClaude } from '@ruimte/agents/chat/fake-claude';
import { inProcess, type InProcessCli } from '@ruimte/agents/chat/fake-cli';
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

// The device of the session this line was written for; both CLIs are asserted against it.
const LINKED: ContextSource[] = [{ id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' }];

const idle = () => recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;

// What a subagent did in the thread: the calls it made and the text it wrote, each under the call that started it.
const subagentWork = (): Array<Extract<ChatItem, { kind: 'tool' | 'assistant' }>> =>
    [...recorder.items.values()].filter(
        (item): item is Extract<ChatItem, { kind: 'tool' | 'assistant' }> =>
            (item.kind === 'tool' || item.kind === 'assistant') && Boolean(item.parentToolUseId)
    );

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

    test('a standalone chat passes its location to the Claude system prompt', async () => {
        await retire(manager);
        manager = makeManager({ standalone: (id) => id === 'chat-view' });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-view', cwd: home });
        manager.attach('chat-view', 'c1');
        await manager.send('chat-view', 'system?');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0, standalone: true }));
    });

    test('the system prompt names the verbs always and the linked sources by name when there are some', async () => {
        await manager.create({ chatId: 'chat-sys', cwd: home });
        manager.attach('chat-sys', 'c1');
        await manager.send('chat-sys', 'system?');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0 }));

        await retire(manager);
        manager = makeManager({ contextSources: () => LINKED, depthOf: () => 2 });
        const linked = new ChatRecorder();
        manager.subscribe('c2', linked.sink());
        await manager.create({ chatId: 'chat-sys-2', cwd: home });
        manager.attach('chat-sys-2', 'c2');
        await manager.send('chat-sys-2', 'system?');
        await linked.until(() => linked.ofKind('assistant').length === 1 && linked.info?.activeTurnId === null);
        // The same sentence a Codex thread is started with, asserted there against the same call.
        expect(linked.ofKind('assistant')[0]?.text).toBe(chatPrompt({ sources: LINKED, depth: 2 }));
        expect(linked.ofKind('assistant')[0]?.text).toContain('"iPhone 18 Pro Max" (device)');
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

    test('a chat attached with @ goes to the CLI as the command that reads it, and to the thread as its id', async () => {
        await retire(manager);
        const titles: Record<string, string> = { 'chat-earlier': 'Auth rewrite' };
        manager = makeManager({ chatTitle: (chatId, id) => (chatId === 'chat-ref' ? (titles[id] ?? null) : null) });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-ref', cwd: home });
        manager.attach('chat-ref', 'c1');

        await manager.send('chat-ref', 'carry on from there', { chats: ['chat-earlier', 'chat-elsewhere'] });
        await recorder.until(idle);

        expect(recorder.ofKind('user')[0]).toMatchObject({ text: 'carry on from there', chats: ['chat-earlier'] });
        // The fake echoes its prompt, so the reply shows what the CLI was given.
        expect(recorder.ofKind('assistant')[0]?.text).toBe(
            `echo: ${chatReferenceNote([{ id: 'chat-earlier', title: 'Auth rewrite' }])}\n\ncarry on from there`
        );
        // Nothing in the thread repeats it: the row draws the chip.
        expect(recorder.ofKind('note')).toEqual([]);
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

    test('a turn the plan refused ends in an error that names the limit and its reset, and the chat can go on', async () => {
        await manager.create({ chatId: 'chat-limit', cwd: home });
        manager.attach('chat-limit', 'c1');
        await manager.send('chat-limit', 'limit:1789000000');
        await recorder.until(idle);
        expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'error', limit: { kind: 'usage', resetsAt: 1_789_000_000_000 } });
        expect(recorder.ofKind('note').map((note) => note.text)).toContain("You've hit your session limit · resets 3pm");
        expect(recorder.info?.limit).toEqual({ kind: 'usage', resetsAt: 1_789_000_000_000 });

        await manager.send('chat-limit', 'overloaded');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(recorder.ofKind('turn')[1]).toMatchObject({ state: 'error', limit: { kind: 'overload' } });
        expect(recorder.info?.limit).toEqual({ kind: 'overload' });

        // The next turn leaves the limit behind, as soon as it opens.
        await manager.send('chat-limit', 'fine');
        expect(recorder.info?.limit).toBeUndefined();
        await recorder.until(() => recorder.info?.usage.turns === 3 && idle());
        expect(recorder.info?.limit).toBeUndefined();
    });

    test('a CLI that dies with something on stderr leaves the last lines of it in the note', async () => {
        await manager.create({ chatId: 'chat-loud', cwd: home });
        manager.attach('chat-loud', 'c1');
        await manager.send('chat-loud', 'crash loudly');
        await recorder.until(() => recorder.info?.running === false && recorder.info.status === 'error');
        const tail = [...Array<string>(8).fill('warming up'), 'Error: the fake lost its key', '    at handleUser (fake-claude.ts)'].join('\n');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: `Claude Code exited with code 1\n\n\`\`\`\n${tail}\n\`\`\`` });
    });

    test('what a crashed CLI left queued goes out before the next message, in the order it was sent', async () => {
        await manager.create({ chatId: 'chat-cq', cwd: home });
        manager.attach('chat-cq', 'c1');
        await manager.send('chat-cq', 'slow');
        await manager.send('chat-cq', 'B');
        await manager.send('chat-cq', 'C');
        claude.started[0]!.crash(1);
        await recorder.until(() => recorder.info?.running === false && recorder.info.status === 'error');
        expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['B', 'C']);

        expect(await manager.send('chat-cq', 'D')).toMatchObject({ queued: true });
        await recorder.until(() => recorder.ofKind('assistant').length === 3 && idle());
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['slow', 'B', 'C', 'D']);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: B', 'echo: C', 'echo: D']);
        expect(recorder.info?.queue).toEqual([]);
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

    test('an agent a background subagent opened hangs under it, and the turn it wakes is about its parent', async () => {
        await manager.create({ chatId: 'chat-nested', cwd: home });
        manager.attach('chat-nested', 'c1');
        await manager.send('chat-nested', 'nested: the chain is done');
        await recorder.until(idle);

        claude.started[0]!.runLater();
        await recorder.until(() => recorder.ofKind('turn').length === 2 && idle());
        const [middle, leaf] = recorder.ofKind('subagent');
        expect(middle).toMatchObject({ toolUseId: 'toolu_middle', status: 'done', background: true, result: 'the leaf said PONG' });
        expect(middle).not.toHaveProperty('parentToolUseId');
        expect(leaf).toMatchObject({ toolUseId: 'toolu_leaf', parentToolUseId: 'toolu_middle', status: 'done', result: 'PONG', turnId: middle!.turnId });
        // No tool row for the grandchild's call, beside the row that already stands for it.
        expect(recorder.ofKind('tool')).toEqual([]);
        expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent', label: 'the chain is done', taskToolUseId: 'toolu_middle' });
    });

    test("a workflow's row carries its phases and agents from the progress reports, and settles with its task", async () => {
        await manager.create({ chatId: 'chat-wf', cwd: home });
        manager.attach('chat-wf', 'c1');
        await manager.send('chat-wf', 'workflow: Write a file, then read it');
        await recorder.until(idle);
        const phases = [
            { index: 1, title: 'Write' },
            { index: 2, title: 'Read' }
        ];
        expect(recorder.ofKind('tool')[0]).toMatchObject({
            name: 'Workflow',
            state: 'running',
            workflow: { name: 'write-and-read', phases, agents: [{ label: 'write-file', phaseIndex: 1, agentId: 'a-writer', status: 'running' }] }
        });

        claude.started[0]!.runLater();
        await recorder.until(() => recorder.ofKind('turn').length === 2 && idle());
        expect(recorder.ofKind('tool')[0]).toMatchObject({
            state: 'done',
            workflow: {
                name: 'write-and-read',
                phases,
                agents: [
                    { label: 'write-file', status: 'done', durationMs: 5000, lastTool: 'Write' },
                    { label: 'read-file', phaseIndex: 2, agentId: 'a-reader', status: 'done', startedAt: 6000, durationMs: 4000 }
                ]
            }
        });
    });

    test("a background agent's approval outlives the turn, and a person allowing it later lets the agent finish", async () => {
        await manager.create({ chatId: 'chat-ask', cwd: home });
        manager.attach('chat-ask', 'c1');
        await manager.send('chat-ask', 'background approval: ls');
        await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done');

        expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending', toolName: 'Bash', toolUseId: 'toolu_bgask_bash' });
        expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });

        manager.approve('chat-ask', 'req-bg', 'allow');
        expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'allow' });
        await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && idle());
        expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent' });
        expect(recorder.ofKind('subagent')[0]).toMatchObject({ toolUseId: 'toolu_bgask', status: 'done' });
        expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'ran: ls', state: 'done' });
    });

    test("stopping the turn cancels a background agent's approval and turns it down for the CLI", async () => {
        await manager.create({ chatId: 'chat-stop-ask', cwd: home });
        manager.attach('chat-stop-ask', 'c1');
        await manager.send('chat-stop-ask', 'background approval: ls\nslow');
        await recorder.until(() => recorder.items.get('approval-req-bg') !== undefined);
        expect(recorder.info?.status).toBe('needs-you');

        manager.cancel('chat-stop-ask');
        await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'aborted');
        expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'cancelled' });
        // The agent heard no, so it finishes instead of waiting on an answer nobody can give any more.
        await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && idle());
        expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'The user stopped the turn', state: 'error' });
    });

    test('a background subagent that settles opens a turn of the agent, with the summary as its label', async () => {
        await manager.create({ chatId: 'chat-bg', cwd: home });
        manager.attach('chat-bg', 'c1');
        await manager.send('chat-bg', 'background: report written');
        await recorder.until(idle);
        expect(recorder.ofKind('turn')).toHaveLength(1);

        // Nothing is sent from here, since the CLI wakes the agent itself once the task settles.
        claude.started[0]!.runLater();
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

    test('a subagent whose work arrives before the CLI says it started keeps that work on its own row', async () => {
        await manager.create({ chatId: 'chat-early', cwd: home });
        manager.attach('chat-early', 'c1');
        await manager.send('chat-early', 'delegate late: read the readme');
        await recorder.until(idle);

        expect(recorder.ofKind('subagent')).toHaveLength(1);
        expect(recorder.ofKind('subagent')[0]).toMatchObject({
            toolUseId: 'toolu_delegate',
            status: 'done',
            background: false,
            subagentType: 'general-purpose',
            lastTool: 'Bash',
            result: '# Report\n\n- one\n- two',
            native: { agentId: 'task-delegate' }
        });
        const work = subagentWork();
        expect(work.map((item) => [item.kind, item.parentToolUseId])).toEqual([
            ['tool', 'toolu_delegate'],
            ['tool', 'toolu_delegate'],
            ['assistant', 'toolu_delegate']
        ]);
        // Nothing of the subagent's reached the thread of the chat itself.
        expect(recorder.ofKind('tool').every((item) => item.parentToolUseId === 'toolu_delegate')).toBe(true);
        expect(
            recorder
                .ofKind('assistant')
                .filter((item) => !item.parentToolUseId)
                .map((item) => item.text)
        ).toEqual(['summarized']);
        expect(recorder.ofKind('turn')).toHaveLength(1);
    });

    test('a background subagent that works on after its turn ended writes on its own row and opens a turn only once it settles', async () => {
        await manager.create({ chatId: 'chat-later', cwd: home });
        manager.attach('chat-later', 'c1');
        await manager.send('chat-later', 'background: report written');
        await recorder.until(idle);
        const launched = recorder.ofKind('turn')[0]!;
        // The person goes on with the chat before the subagent is done.
        await manager.send('chat-later', 'next question');
        await recorder.until(() => idle() && recorder.ofKind('turn').length === 2);

        claude.started[0]!.runLater();
        await recorder.until(() => recorder.ofKind('subagent')[0]?.result === 'the subagent says: report written');
        expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'running', turnId: launched.id });
        const work = subagentWork();
        expect(work.map((item) => [item.kind, item.parentToolUseId, item.turnId])).toEqual([
            ['tool', 'toolu_agent', launched.id],
            ['tool', 'toolu_agent', launched.id],
            ['assistant', 'toolu_agent', launched.id]
        ]);
        expect(recorder.ofKind('turn')).toHaveLength(2);
        expect(idle()).toBe(true);
        expect(
            recorder
                .ofKind('assistant')
                .filter((item) => !item.parentToolUseId)
                .map((item) => item.text)
        ).toEqual(['I will report back', 'echo: next question']);

        claude.started[0]!.runLater();
        await recorder.until(() => idle() && recorder.ofKind('turn').length === 3);
        expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'done', turnId: launched.id });
        expect(recorder.ofKind('turn')[2]).toMatchObject({ origin: 'agent', label: 'report written', taskToolUseId: 'toolu_agent' });
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

    test('kill drops the thread and its record, after the write that was still out', async () => {
        await manager.create({ chatId: 'chat-7', cwd: home });
        manager.attach('chat-7', 'c1');
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
        await manager.create({ chatId: 'chat-q', cwd: home });
        manager.attach('chat-q', 'c1');
        const first = await manager.send('chat-q', 'first');
        const second = await manager.send('chat-q', 'second');
        const third = await manager.send('chat-q', 'third');
        expect(first).toMatchObject({ queued: false });
        expect(second).toMatchObject({ queued: true });
        expect(third).toMatchObject({ queued: true });
        expect(recorder.info?.queue?.map((message) => message.text)).toEqual(['second', 'third']);

        await recorder.until(() => recorder.ofKind('user').length === 3 && idle());
        const messages = recorder.ofKind('user');
        expect(messages.map((item) => item.text)).toEqual(['first', 'second', 'third']);
        expect(messages.map((item) => item.turnId)).toEqual([first.turnId, second.turnId, third.turnId]);
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

        // A daemon that goes down mid-turn must not lose what was waiting behind it, which the log holds at once.
        manager.get('chat-q2')?.dispose();
        const reloaded = makeManager();
        expect((await reloaded.create({ chatId: 'chat-q2' })).queue?.map((message) => message.text)).toEqual(['kept']);
        await retire(reloaded);
    });

    test('a queued message taken back to edit comes back whole, and one that already went out comes back as nothing', async () => {
        await manager.create({ chatId: 'chat-q4', cwd: home });
        manager.attach('chat-q4', 'c1');
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

describe("stopping a subagent of the CLI's own", () => {
    test('is refused while the turn that may wait on it runs, and marks the row stopped with a note once none runs', async () => {
        await manager.create({ chatId: 'chat-stop', cwd: home });
        manager.attach('chat-stop', 'c1');
        const session = manager.get('chat-stop')!;
        session.thread.upsert({
            id: '1:toolu_bg',
            kind: 'subagent',
            createdAt: 1,
            turnId: null,
            toolUseId: 'toolu_bg',
            description: 'Review the branch',
            subagentType: 'general-purpose',
            prompt: null,
            background: true,
            status: 'running',
            startedAt: 1,
            finishedAt: null,
            summary: null,
            result: null,
            usage: null,
            lastTool: null,
            itemsTruncated: false
        });

        void manager.send('chat-stop', 'slow');
        await recorder.until(() => recorder.info?.activeTurnId !== null);
        await expect(manager.stopSubagent('chat-stop', 'toolu_bg')).rejects.toMatchObject({ code: 'chat-busy' });
        manager.cancel('chat-stop');
        await recorder.until(() => recorder.info?.activeTurnId === null);

        await manager.stopSubagent('chat-stop', 'toolu_bg');
        expect(recorder.items.get('1:toolu_bg')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
        expect(recorder.ofKind('note').map((note) => note.text)).toContain(
            '"Review the branch" was marked as stopped. Claude Code cannot stop one sub-agent on its own, so it may keep working until the chat\'s process ends.'
        );
        await manager.stopSubagent('chat-stop', 'toolu_bg');
        await expect(manager.stopSubagent('chat-stop', 'toolu_none')).rejects.toMatchObject({ code: 'subagent-not-found' });
    });
});
/*
 * A message another node left reaches two readers, a person in the thread the moment it lands and
 * the model once, in front of its next prompt. Wired the way the daemon wires it, so the test says
 * what a person and an agent really get.
 */
describe('a message another node left', () => {
    let notices: NoticeStore;

    const withNotices = (): ChatManager =>
        makeManager({
            messages: (chatId) => notices.take(chatId).map(renderNotice),
            unshownMessages: async (chatId) => (await notices.show(chatId)).map(noticeNote)
        });

    const notify = async (targetId: string, text: string): Promise<void> => {
        const notice: Omit<Notice, 'createdAt'> = { projectId: 'project-1', targetId, from: 'term-1', fromTitle: 'dev server', text };
        await deliverNotice(
            notices,
            {
                terminal: () => null,
                // No outbox in these tests, so the message waits for the turn the test sends itself.
                chat: async (id) => (manager.get(id) === undefined ? 'none' : 'running'),
                fromMessage: () => false
            },
            notice
        );
        await showNotices(notices, { has: (id) => manager.hasStored(id), note: (id, line) => manager.addNote(id, 'info', line) }, targetId);
    };

    const heard = 'Ruimte: node term-1 ("dev server") sent you a message: the build is green';
    const read = 'dev server sent a message: the build is green';

    beforeEach(async () => {
        await retire(manager);
        notices = new NoticeStore(home);
        manager = withNotices();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());
    });

    test('lands in the thread of a running chat at once, and in front of its next prompt once', async () => {
        await manager.create({ chatId: 'chat-msg', cwd: home });
        manager.attach('chat-msg', 'c1');
        await manager.send('chat-msg', 'first');
        await recorder.until(idle);

        await notify('chat-msg', 'the build is green');
        await recorder.until(() => recorder.ofKind('note').length === 1);
        // Outside any turn, since nothing the model did put it there.
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'info', turnId: null, text: read });

        await manager.send('chat-msg', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        await manager.send('chat-msg', 'third');
        await recorder.until(() => recorder.info?.usage.turns === 3 && idle());

        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', `echo: ${heard}\n\nsecond`, 'echo: third']);
        /* One line for a person, written when the message landed. The turn that carried it to the
           model adds none of its own, since its preamble only repeats what the thread already says. */
        expect(recorder.ofKind('note')).toHaveLength(1);
    });

    test('waits for a chat nobody has started, and is in the thread before its first prompt', async () => {
        await notify('chat-cold', 'the build is green');
        // Nothing holds that id yet, so nothing was shown and nothing was taken.
        expect(notices.waiting('chat-cold')).toHaveLength(1);

        await manager.create({ chatId: 'chat-cold', cwd: home });
        expect(manager.attach('chat-cold', 'c1').items).toEqual([expect.objectContaining({ kind: 'note', level: 'info', turnId: null, text: read })]);

        await manager.send('chat-cold', 'what happened');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });

    test('is in the thread once after a restart, whether or not the model heard it yet', async () => {
        await manager.create({ chatId: 'chat-again', cwd: home });
        manager.attach('chat-again', 'c1');
        await notify('chat-again', 'the build is green');
        await store.written('chat-again', (record) => record.items.some((item) => item.kind === 'note'));

        await retire(manager);
        notices = new NoticeStore(home);
        await notices.load();
        manager = withNotices();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-again', cwd: home });
        expect(manager.attach('chat-again', 'c1').items.filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ text: read })]);
        // And the model, which had not heard it when the daemon went down, still hears it exactly once.
        await manager.send('chat-again', 'what happened');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });
});

describe('bookmarks', () => {
    test('a bookmark goes to every client reading the chat, rides on the next attach and goes with a clear', async () => {
        await retire(manager);
        manager = makeManager({ bookmarks: new BookmarkStore(home) });
        manager.subscribe('c1', recorder.sink());
        const heard: Array<{ clientId: string; bookmarks: ChatBookmark[] }> = [];
        for (const clientId of ['c2', 'c3']) {
            manager.subscribe(clientId, (event: SessionEvent) => {
                if (event.event === 'chat.bookmarks') {
                    heard.push({ clientId, bookmarks: event.payload.bookmarks });
                }
            });
        }
        await manager.create({ chatId: 'chat-b', cwd: home });
        manager.attach('chat-b', 'c1');
        await manager.send('chat-b', 'hello  there');
        await recorder.until(idle);
        manager.attach('chat-b', 'c2');

        const reply = recorder.ofKind('assistant')[0]!;
        const list = await manager.addBookmark('chat-b', reply.id, 'The answer');
        expect(list).toEqual([{ itemId: reply.id, name: 'The answer', excerpt: 'echo: hello there', createdAt: expect.any(Number) }]);
        // A client that is not reading the thread hears nothing and gets the list when it attaches.
        expect(heard).toEqual([{ clientId: 'c2', bookmarks: list }]);
        expect((await manager.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual(list);

        const turn = recorder.ofKind('turn')[0]!;
        expect(() => manager.addBookmark('chat-b', turn.id)).toThrow('no message');

        await manager.clear('chat-b');
        expect(heard.slice(1)).toEqual([
            { clientId: 'c2', bookmarks: [] },
            { clientId: 'c3', bookmarks: [] }
        ]);
        expect((await manager.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual([]);
    });
});
