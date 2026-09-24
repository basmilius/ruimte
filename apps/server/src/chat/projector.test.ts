import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/contracts';
import type { BackendEvent } from './backend.ts';
import { ThreadProjector, stripAgentFooter, summaryLine } from './projector.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    status: 'running',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
};

const setup = (generation = 1) => {
    const thread = new ChatThread(info);
    thread.upsert({ id: 'turn-1', kind: 'turn', createdAt: 0, turnId: 'turn-1', state: 'running', origin: 'user', endedAt: null, costUsd: 0 });
    let clock = 1;
    const projector = new ThreadProjector(thread, { providerName: 'Test CLI', now: () => clock++ });
    const project = (...events: BackendEvent[]) => events.flatMap((event) => projector.project(generation, event));
    return { thread, projector, project };
};

// A chat between turns: the CLI is alive, nobody asked it anything, and no turn is open.
const idleSetup = () => {
    const thread = new ChatThread({ ...info, status: 'idle', activeTurnId: null });
    let clock = 1;
    const projector = new ThreadProjector(thread, { providerName: 'Test CLI', now: () => clock++ });
    const project = (...events: BackendEvent[]) => events.flatMap((event) => projector.project(1, event));
    const openTurn = () => thread.list().find((item) => item.kind === 'turn');
    return { thread, project, openTurn };
};

describe('ThreadProjector', () => {
    test('a session event fills in what the CLI told about itself', () => {
        const { thread, project } = setup();
        project({ type: 'session', agentSessionId: 'sid', model: 'sonnet', slashCommands: ['compact'] });
        expect(thread.info).toMatchObject({ agentSessionId: 'sid', model: 'sonnet', slashCommands: ['compact'], running: true });
        // A later frame without a model leaves the one that is known.
        project({ type: 'session', agentSessionId: null, model: null });
        expect(thread.info).toMatchObject({ agentSessionId: 'sid', model: 'sonnet' });
    });

    test('text streams into one item per ref and the generation keeps a resumed process apart', () => {
        const { thread, project } = setup();
        expect(project({ type: 'text.delta', ref: 'msg_1:t0', text: '' })[0]).toMatchObject({
            type: 'item',
            item: { id: '1:msg_1:t0', kind: 'assistant', text: '', streaming: true, turnId: 'turn-1' }
        });
        expect(project({ type: 'text.delta', ref: 'msg_1:t0', text: 'po' })).toEqual([{ type: 'delta', itemId: '1:msg_1:t0', text: 'po' }]);
        project({ type: 'text.delta', ref: 'msg_1:t0', text: 'ng' }, { type: 'text.done', ref: 'msg_1:t0', text: 'pong' });
        expect(thread.get('1:msg_1:t0')).toMatchObject({ text: 'pong', streaming: false });

        const second = new ThreadProjector(thread, { providerName: 'Test CLI' });
        second.project(2, { type: 'text.done', ref: 'msg_1:t0', text: 'other' });
        expect(thread.get('1:msg_1:t0')).toMatchObject({ text: 'pong' });
        expect(thread.get('2:msg_1:t0')).toMatchObject({ text: 'other' });
    });

    test('a tool call keeps its native id, collects progress and output, and drops both when it settles', () => {
        const { thread, project } = setup();
        project({ type: 'tool.started', ref: 'toolu_1', name: 'Bash', input: { command: 'sleep 30' }, parentRef: null });
        expect(thread.get('1:toolu_1')).toMatchObject({ kind: 'tool', toolUseId: 'toolu_1', name: 'Bash', state: 'running', output: null });

        project({ type: 'tool.progress', ref: 'toolu_1', startedAt: null, description: 'Wait a while' });
        project({ type: 'tool.progress', ref: 'toolu_1', startedAt: 1000, description: null });
        expect(thread.get('1:toolu_1')).toMatchObject({ progress: { startedAt: 1000, description: 'Wait a while', output: null } });

        expect(project({ type: 'tool.output', ref: 'toolu_1', text: 'line1\n' })).toEqual([{ type: 'delta', itemId: '1:toolu_1', text: 'line1\n' }]);
        project({ type: 'tool.output', ref: 'toolu_1', text: 'line2' });
        expect(thread.get('1:toolu_1')).toMatchObject({ progress: { output: 'line1\nline2' } });

        project({ type: 'tool.done', ref: 'toolu_1', output: 'ok', state: 'done' });
        expect(thread.get('1:toolu_1')).toMatchObject({ state: 'done', output: 'ok' });
        expect(thread.get('1:toolu_1')).not.toHaveProperty('progress');
        // Nothing waits under an unknown ref, and a settled call takes no more progress.
        expect(project({ type: 'tool.done', ref: 'nope', output: 'x', state: 'done' })).toEqual([]);
        expect(project({ type: 'tool.progress', ref: 'toolu_1', startedAt: 5, description: null })).toEqual([]);
    });

    test('unified diffs ride along on the tool item that settles', () => {
        const { thread, project } = setup();
        const changes = [{ path: 'a.ts', kind: 'update' as const, diff: '-x\n+y\n' }];
        project({ type: 'tool.started', ref: 'patch-1', name: 'ApplyPatch', input: { summary: 'a.ts' }, parentRef: null });
        project({ type: 'tool.done', ref: 'patch-1', output: '-x\n+y\n', state: 'done', changes });
        expect(thread.get('1:patch-1')).toMatchObject({ state: 'done', changes });
    });

    test('the agent talking outside a turn opens one of its own, labeled with the task that woke it', () => {
        const { thread, project, openTurn } = idleSetup();
        project({ type: 'task.done', ref: 'toolu_agent', summary: 'Report written', ok: true });
        expect(openTurn()).toBeUndefined();

        project({ type: 'text.delta', ref: 'msg_9:t0', text: 'The report is done' });
        const turn = openTurn();
        expect(turn).toMatchObject({ kind: 'turn', state: 'running', origin: 'agent', label: 'Report written' });
        expect(thread.info).toMatchObject({ status: 'running', activeTurnId: turn?.id ?? '' });
        // No message of the person in front of it, and the text belongs to the new turn.
        expect(thread.list().some((item) => item.kind === 'user')).toBe(false);
        expect(thread.get('1:msg_9:t0')).toMatchObject({ turnId: turn?.id ?? '' });

        project({ type: 'turn.done', state: 'done', costUsd: 0.02 });
        expect(thread.get(turn?.id ?? '')).toMatchObject({ state: 'done', endedAt: expect.any(Number) });
        expect(thread.info).toMatchObject({ status: 'idle', activeTurnId: null, usage: { turns: 1 } });
    });

    test('a turn the CLI opens without a task behind it has no label, and the summary is used once', () => {
        const first = idleSetup();
        first.project({ type: 'text.done', ref: 'msg_1:t0', text: 'going on' });
        expect(first.openTurn()).toMatchObject({ origin: 'agent' });
        expect(first.openTurn()).not.toHaveProperty('label');

        const second = idleSetup();
        second.project({ type: 'task.done', ref: null, summary: 'Sleep finished', ok: true }, { type: 'text.done', ref: 'msg_1:t0', text: 'a' });
        second.project({ type: 'turn.done', state: 'done', costUsd: 0 });
        second.project({ type: 'text.done', ref: 'msg_2:t0', text: 'b' });
        const turns = second.thread.list().filter((item) => item.kind === 'turn');
        expect(turns).toHaveLength(2);
        expect(turns[0]).toMatchObject({ label: 'Sleep finished' });
        expect(turns[1]).not.toHaveProperty('label');
    });

    test('a frame from a subagent never opens a turn of its own', () => {
        const { thread, project, openTurn } = idleSetup();
        project({ type: 'tool.started', ref: 'toolu_inner', name: 'Bash', input: { command: 'sleep 20' }, parentRef: 'toolu_agent' });
        project({ type: 'tool.done', ref: 'toolu_inner', output: 'ok', state: 'done' });
        expect(openTurn()).toBeUndefined();
        expect(thread.get('1:toolu_inner')).toMatchObject({ turnId: null, parentToolUseId: 'toolu_agent' });
        expect(thread.info).toMatchObject({ status: 'idle', activeTurnId: null });
    });

    test('an approval waits under its request id and a withdrawal cancels it', () => {
        const { thread, project } = setup();
        project({
            type: 'approval.requested',
            requestId: 'r1',
            ref: 'toolu_9',
            toolName: 'Edit',
            input: { file_path: 'a.ts' },
            description: 'Change a file',
            canAllowAlways: false
        });
        expect(thread.get('approval-r1')).toMatchObject({ kind: 'approval', toolUseId: 'toolu_9', toolName: 'Edit', decision: 'pending' });
        expect(thread.info.status).toBe('needs-you');

        project({ type: 'request.withdrawn', requestId: 'r1' });
        expect(thread.get('approval-r1')).toMatchObject({ decision: 'cancelled' });
        expect(thread.info.status).toBe('running');
    });

    test('a question waits under its request id', () => {
        const { thread, project } = setup();
        const questions = [{ id: '0', header: 'Pick', question: 'Which?', choices: [{ label: 'A', description: '' }], multiSelect: false }];
        project({ type: 'question.requested', requestId: 'q1', questions });
        expect(thread.get('question-q1')).toMatchObject({ kind: 'question', state: 'pending', answers: null, questions });
        expect(thread.info.status).toBe('needs-you');
        project({ type: 'request.withdrawn', requestId: 'q1' });
        expect(thread.get('question-q1')).toMatchObject({ state: 'cancelled' });
    });

    test('usage patches only what the CLI reported, and a compaction falls back to the tokens it knows', () => {
        const { thread, project } = setup();
        project({ type: 'usage', contextTokens: 25090, contextWindow: 258400 });
        project({ type: 'usage', contextTokens: 30000 });
        expect(thread.info.usage).toMatchObject({ contextTokens: 30000, contextWindow: 258400 });
        project({ type: 'compaction', preTokens: null });
        expect(thread.list().at(-1)).toMatchObject({ kind: 'compaction', preTokens: 30000, turnId: 'turn-1' });
        project({ type: 'compaction', preTokens: 5000 });
        expect(thread.list().at(-1)).toMatchObject({ kind: 'compaction', preTokens: 5000 });
    });

    test('usage estimates what the context holds and starts over after a compaction', () => {
        const { thread, project } = setup();
        project({ type: 'tool.started', ref: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' }, parentRef: null });
        project({ type: 'tool.done', ref: 'toolu_1', output: 'x'.repeat(40_000), state: 'done' });
        project({ type: 'usage', contextTokens: 30_000 });
        const before = thread.info.usage.breakdown!;
        expect(before.filesRead).toBeGreaterThan(before.toolOutput + before.conversation);
        expect(before.filesRead + before.toolOutput + before.conversation + before.system).toBe(30_000);
        project({ type: 'compaction', preTokens: 30_000 });
        project({ type: 'usage', contextTokens: 8000 });
        expect(thread.info.usage.breakdown).toEqual({ filesRead: 0, toolOutput: 0, conversation: 0, system: 8000 });
    });

    test('turn.done closes the turn with what it cost, settles what was open and counts the turn', () => {
        const { thread, project } = setup();
        project({ type: 'text.delta', ref: 'msg_1:t0', text: 'half' });
        project({ type: 'tool.started', ref: 'toolu_1', name: 'Bash', input: {}, parentRef: null });
        project({ type: 'turn.done', state: 'done', costUsd: 0.02 });
        expect(thread.get('turn-1')).toMatchObject({ state: 'done', costUsd: 0.02, endedAt: expect.any(Number) });
        expect(thread.get('1:msg_1:t0')).toMatchObject({ streaming: false });
        expect(thread.get('1:toolu_1')).toMatchObject({ state: 'error' });
        expect(thread.info).toMatchObject({ status: 'idle', activeTurnId: null, usage: { costUsd: 0.02, turns: 1 } });
    });

    test("the CLI's own name for where a turn ended is kept on the turn", () => {
        const { thread, project } = setup();
        project({ type: 'turn.done', state: 'done', costUsd: 0, native: { lastUuid: 'u-2' } });
        expect(thread.get('turn-1')).toMatchObject({ native: { lastUuid: 'u-2' } });
    });

    test('a failing turn leaves a note, and a failure outside a turn leaves the chat in error', () => {
        const { thread, project } = setup();
        project({ type: 'turn.done', state: 'error', costUsd: 0, error: 'The model is overloaded' });
        expect(thread.list().filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ level: 'error', text: 'The model is overloaded' })]);
        expect(thread.get('turn-1')).toMatchObject({ state: 'error' });
        expect(thread.info.status).toBe('idle');

        const other = setup();
        other.project({ type: 'failed', message: 'spawn failed' });
        expect(other.thread.get('turn-1')).toMatchObject({ state: 'error' });
        expect(other.thread.info).toMatchObject({ status: 'error', activeTurnId: null, usage: { turns: 0 } });
    });

    test('an exit while the chat was busy names the CLI and ends the turn in error', () => {
        const { thread, project } = setup();
        project({ type: 'text.delta', ref: 'msg_1:t0', text: 'half' });
        project({ type: 'exit', exitCode: 1 });
        expect(thread.get('1:msg_1:t0')).toMatchObject({ streaming: false });
        expect(thread.list().at(-1)).toMatchObject({ kind: 'note', level: 'error', text: 'Test CLI exited with code 1' });
        expect(thread.get('turn-1')).toMatchObject({ state: 'error' });
        expect(thread.info).toMatchObject({ running: false, status: 'error', activeTurnId: null });
    });

    test('the last of stderr follows the reason in a code block that its own backticks cannot close', () => {
        const { thread, project } = setup();
        project({ type: 'exit', exitCode: 2, stderr: 'Error: no key\n```oops```' });
        expect(thread.list().at(-1)).toMatchObject({
            kind: 'note',
            level: 'error',
            text: 'Test CLI exited with code 2\n\n````\nError: no key\n```oops```\n````'
        });
    });

    test('an exit of an idle chat is quiet', () => {
        const { thread, project } = setup();
        project({ type: 'turn.done', state: 'done', costUsd: 0 });
        project({ type: 'exit', exitCode: 0 });
        expect(thread.list().some((item) => item.kind === 'note')).toBe(false);
        expect(thread.info).toMatchObject({ running: false, status: 'idle' });
    });
});

describe('thinking', () => {
    test('consecutive blocks are one item, and the first answer closes it', () => {
        const { thread, project } = setup();
        project(
            { type: 'thinking.delta', ref: 'm1:k0', text: 'first ' },
            { type: 'thinking.delta', ref: 'm1:k0', text: 'thought' },
            { type: 'thinking.delta', ref: 'm1:k1', text: 'second thought' }
        );
        const thinking = thread.list().filter((item) => item.kind === 'thinking');
        expect(thinking).toHaveLength(1);
        expect(thinking[0]).toMatchObject({ text: 'first thought\n\nsecond thought', streaming: true, endedAt: null, turnId: 'turn-1' });

        project({ type: 'text.delta', ref: 'm1:t0', text: 'the answer' });
        const settled = thread.list().find((item) => item.kind === 'thinking');
        expect(settled).toMatchObject({ streaming: false });
        expect(settled?.kind === 'thinking' && settled.endedAt).not.toBeNull();
        // The row sits in front of the answer it led to.
        expect(thread.list().map((item) => item.kind)).toEqual(['turn', 'thinking', 'assistant']);
    });

    test('a second stretch after the answer is its own item', () => {
        const { thread, project } = setup();
        project(
            { type: 'thinking.delta', ref: 'm1:k0', text: 'before' },
            { type: 'text.done', ref: 'm1:t0', text: 'partial' },
            { type: 'thinking.delta', ref: 'm2:k0', text: 'after' }
        );
        expect(
            thread
                .list()
                .filter((item) => item.kind === 'thinking')
                .map((item) => item.text)
        ).toEqual(['before', 'after']);
    });

    test('a done for a ref that already streamed adds nothing, and one that did not opens the item', () => {
        const { thread, project } = setup();
        project({ type: 'thinking.delta', ref: 'm1:k0', text: 'streamed' }, { type: 'thinking.done', ref: 'm1:k0', text: 'streamed' });
        expect(
            thread
                .list()
                .filter((item) => item.kind === 'thinking')
                .map((item) => item.text)
        ).toEqual(['streamed']);

        const other = setup();
        other.project({ type: 'thinking.done', ref: 'r1', text: 'replayed' });
        expect(
            other.thread
                .list()
                .filter((item) => item.kind === 'thinking')
                .map((item) => item.text)
        ).toEqual(['replayed']);
    });

    test('an empty block opens nothing, so a CLI that always sends one costs no row', () => {
        const { thread, project } = setup();
        project({ type: 'thinking.delta', ref: 'm1:k0', text: '' }, { type: 'text.done', ref: 'm1:t0', text: 'hi' });
        expect(thread.list().some((item) => item.kind === 'thinking')).toBe(false);
    });

    test('a turn that ends while it thinks leaves the row settled', () => {
        const { thread, project } = setup();
        project({ type: 'thinking.delta', ref: 'm1:k0', text: 'halfway' }, { type: 'turn.done', state: 'aborted', costUsd: 0 });
        expect(thread.list().find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false });
    });

    test('thinking alone opens a turn the CLI started itself', () => {
        const { project, openTurn } = idleSetup();
        project({ type: 'thinking.delta', ref: 'm1:k0', text: 'unprompted' });
        expect(openTurn()).toMatchObject({ origin: 'agent', state: 'running' });
    });
});

describe('subagents', () => {
    test('a delegation opens a subagent row and its own work hangs under it', () => {
        const { thread, project } = setup();
        project({
            type: 'tool.started',
            ref: 'toolu_agent',
            name: 'Agent',
            input: { description: 'Find the bug', subagent_type: 'general-purpose', prompt: 'look around' },
            parentRef: null
        });
        expect(thread.get('1:toolu_agent')).toMatchObject({
            kind: 'subagent',
            toolUseId: 'toolu_agent',
            description: 'Find the bug',
            subagentType: 'general-purpose',
            prompt: 'look around',
            background: false,
            status: 'running',
            result: null,
            itemsTruncated: false
        });
        // No tool row for the call itself: the subagent row is what says it happened.
        expect(thread.list().some((item) => item.kind === 'tool')).toBe(false);

        project({ type: 'task.started', ref: 'toolu_agent', description: 'Find the bug', subagentType: 'explorer', prompt: null, background: true });
        project({
            type: 'task.progress',
            ref: 'toolu_agent',
            summary: 'Running Grep',
            lastTool: 'Grep',
            usage: { totalTokens: 10, toolUses: 1, durationMs: 5 }
        });
        expect(thread.get('1:toolu_agent')).toMatchObject({
            background: true,
            summary: 'Running Grep',
            lastTool: 'Grep',
            usage: { totalTokens: 10, toolUses: 1, durationMs: 5 }
        });

        project(
            { type: 'tool.started', ref: 'toolu_child', name: 'Grep', input: { pattern: 'x' }, parentRef: 'toolu_agent' },
            { type: 'tool.done', ref: 'toolu_child', output: 'found', state: 'done' },
            { type: 'text.done', ref: 'msg_9:t0', text: 'the bug is in a.ts', parentRef: 'toolu_agent' }
        );
        const child = thread.get('1:toolu_child');
        expect(child).toMatchObject({ kind: 'tool', parentToolUseId: 'toolu_agent', state: 'done', turnId: 'turn-1' });
        expect(thread.get('1:msg_9:t0')).toMatchObject({ kind: 'assistant', parentToolUseId: 'toolu_agent', text: 'the bug is in a.ts' });
        // The last thing it wrote is the report it ends with, until the call itself says otherwise.
        expect(thread.get('1:toolu_agent')).toMatchObject({ result: 'the bug is in a.ts' });
    });

    test('the turn a background subagent outlives keeps it running, and the process taking it down fails it', () => {
        const { thread, project } = setup();
        project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: { run_in_background: true }, parentRef: null },
            { type: 'tool.done', ref: 'toolu_agent', output: 'Async agent launched successfully. agentId: a1 output_file: /tmp/a1.output', state: 'done' },
            { type: 'turn.done', state: 'done', costUsd: 0 }
        );
        expect(thread.get('1:toolu_agent')).toMatchObject({ status: 'running', background: true, outputFile: '/tmp/a1.output' });

        project({ type: 'exit', exitCode: 0 });
        expect(thread.get('1:toolu_agent')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
    });

    test('a foreground call settles its subagent with the report, without the footer the CLI appends', () => {
        const { thread, project } = setup();
        const footer =
            "\n\nagentId: agent_1 (use SendMessage with to: 'agent_1', summary: 'the report' to continue this agent)" +
            '\n<usage>subagent_tokens: 1500\ntool_uses: 2\nduration_ms: 250</usage>';
        project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: { description: 'Read it' }, parentRef: null },
            { type: 'tool.done', ref: 'toolu_agent', output: `# Report\n\n- one${footer}`, state: 'done' }
        );
        expect(thread.get('1:toolu_agent')).toMatchObject({
            status: 'done',
            result: '# Report\n\n- one',
            usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 },
            finishedAt: expect.any(Number)
        });

        // A call that failed leaves the row failed, with whatever it did say.
        const other = setup();
        other.project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Task', input: {}, parentRef: null },
            { type: 'tool.done', ref: 'toolu_agent', output: 'it went wrong', state: 'error' }
        );
        expect(other.thread.get('1:toolu_agent')).toMatchObject({ status: 'failed', result: 'it went wrong' });
    });

    test('a notification settles a background subagent and names the turn the CLI opens next', () => {
        const { thread, project } = setup();
        project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: { run_in_background: true }, parentRef: null },
            { type: 'tool.done', ref: 'toolu_agent', output: 'Async agent launched successfully.', state: 'done' },
            // The turn that launched it ends; the agent goes on working outside a turn.
            { type: 'turn.done', state: 'done', costUsd: 0 },
            { type: 'text.done', ref: 'msg_9:t0', text: 'the report', parentRef: 'toolu_agent' },
            { type: 'task.done', ref: 'toolu_agent', summary: 'read the docs', ok: true, usage: { totalTokens: 20, toolUses: 3, durationMs: 40 } }
        );
        expect(thread.get('1:toolu_agent')).toMatchObject({
            status: 'done',
            summary: 'read the docs',
            result: 'the report',
            usage: { totalTokens: 20, toolUses: 3, durationMs: 40 }
        });

        // The wake-up turn says what it is about and points at the row it came from.
        project({ type: 'text.done', ref: 'msg_10:t0', text: 'here is what it found' });
        const agentTurn = thread.list().find((item) => item.kind === 'turn' && item.origin === 'agent');
        expect(agentTurn).toMatchObject({ label: 'read the docs', taskToolUseId: 'toolu_agent' });

        // A second notification for the same agent only updates what came of it.
        project({ type: 'task.done', ref: 'toolu_agent', summary: 'read the docs twice', ok: true });
        expect(thread.get('1:toolu_agent')).toMatchObject({ status: 'done', summary: 'read the docs twice' });
    });

    test('a subagent that works past the cap keeps the beginning and says it was cut', () => {
        const { thread, project } = setup();
        project({ type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: {}, parentRef: null });
        for (let i = 0; i < 205; i++) {
            project({ type: 'tool.started', ref: `child_${i}`, name: 'Read', input: {}, parentRef: 'toolu_agent' });
        }
        const children = thread.list().filter((item) => item.kind === 'tool' && item.parentToolUseId === 'toolu_agent');
        expect(children).toHaveLength(200);
        expect(thread.get('1:toolu_agent')).toMatchObject({ itemsTruncated: true });
    });

    test('a subagent whose text outgrows the cap stops collecting', () => {
        const { thread, project } = setup();
        project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: {}, parentRef: null },
            { type: 'text.done', ref: 'msg_1:t0', text: 'x'.repeat(70 * 1024), parentRef: 'toolu_agent' },
            { type: 'tool.started', ref: 'child_late', name: 'Read', input: {}, parentRef: 'toolu_agent' }
        );
        expect(thread.get('1:child_late')).toBeUndefined();
        expect(thread.get('1:toolu_agent')).toMatchObject({ itemsTruncated: true });
    });

    test('a report handed in as the summary is one line on the header and stays whole on the row', () => {
        const { thread, project } = setup();
        const report =
            'Rewrote the parser so it reads the header before the body, which is what the spec asks for and what the old code only did by accident\n\n- the tests pass\n- nothing else changed';
        project(
            { type: 'tool.started', ref: 'toolu_agent', name: 'Agent', input: { run_in_background: true }, parentRef: null },
            { type: 'tool.done', ref: 'toolu_agent', output: 'Async agent launched successfully.', state: 'done' },
            { type: 'turn.done', state: 'done', costUsd: 0 },
            { type: 'task.done', ref: 'toolu_agent', summary: report, ok: true }
        );
        project({ type: 'text.done', ref: 'msg_1:t0', text: 'here is what it found' });

        const turn = thread.list().find((item) => item.kind === 'turn' && item.origin === 'agent');
        const label = turn?.kind === 'turn' ? (turn.label ?? '') : '';
        expect(label).toBe('Rewrote the parser so it reads the header before the body, which is what the...');
        // The report is not thrown away, it only moves: the row's "Show result" fold has all of it.
        expect(thread.get('1:toolu_agent')).toMatchObject({ summary: label, result: report });
    });

    test('summaryLine takes the first line that says something and never grows past a header', () => {
        expect(summaryLine('  \n\nWrote the docs\nand more')).toBe('Wrote the docs');
        expect(summaryLine('short enough')).toBe('short enough');
        expect(summaryLine('x'.repeat(120))).toBe(`${'x'.repeat(80)}...`);
        expect(summaryLine('')).toBe('');
    });

    test('the footer strip survives a CLI that says it a little differently', () => {
        expect(stripAgentFooter('done\nagentId: a1 (use SendMessage ...)')).toEqual({ text: 'done', usage: null });
        expect(stripAgentFooter('(Subagent completed but returned no output.)')).toEqual({ text: null, usage: null });
        expect(stripAgentFooter('kept as it is')).toEqual({ text: 'kept as it is', usage: null });
    });
});

describe('background tasks', () => {
    test('a task takes its kind and command from the call that started it and leaves with its process', () => {
        const { thread, project } = setup();
        project(
            { type: 'tool.started', ref: 'toolu_b', name: 'Bash', input: { command: 'bun run dev', run_in_background: true }, parentRef: null },
            { type: 'tool.started', ref: 'toolu_m', name: 'Monitor', input: { command: 'tail -f log' }, parentRef: null },
            { type: 'background.started', taskId: 'b', ref: 'toolu_b', monitor: false, description: 'Start the dev server' },
            { type: 'background.started', taskId: 'm', ref: 'toolu_m', monitor: false, description: 'Watch the log' },
            { type: 'background.started', taskId: 'b', ref: 'toolu_b', monitor: false, description: 'Start the dev server' }
        );
        expect(thread.info.background).toEqual([
            { id: 'b', kind: 'shell', description: 'Start the dev server', command: 'bun run dev', startedAt: expect.any(Number) },
            { id: 'm', kind: 'monitor', description: 'Watch the log', command: 'tail -f log', startedAt: expect.any(Number) }
        ]);
        project({ type: 'background.ended', taskId: 'b' });
        expect(thread.info.background?.map((task) => task.id)).toEqual(['m']);
        project({ type: 'exit', exitCode: 0 });
        expect(thread.info.background).toEqual([]);
    });

    test('a call that runs on past its turn keeps its row running and settles it without opening a turn', () => {
        const { thread, project } = setup();
        project(
            { type: 'tool.started', ref: 'exec', name: 'Bash', input: { command: 'bun run dev' }, parentRef: null },
            { type: 'background.started', taskId: '44653', ref: 'exec', monitor: false, description: null },
            { type: 'turn.done', state: 'done', costUsd: 0 }
        );
        expect(thread.get('1:exec')).toMatchObject({ state: 'running' });
        expect(thread.info.background).toEqual([{ id: '44653', kind: 'shell', description: '', command: 'bun run dev', startedAt: expect.any(Number) }]);
        project({ type: 'tool.done', ref: 'exec', output: 'stopped', state: 'error' }, { type: 'background.ended', taskId: '44653' });
        expect(thread.get('1:exec')).toMatchObject({ state: 'error', output: 'stopped' });
        expect(thread.info).toMatchObject({ activeTurnId: null, status: 'idle', background: [] });
    });
});
