import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/contracts';
import type { BackendEvent } from './backend.ts';
import { ThreadProjector } from './projector.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    status: 'running',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
};

const setup = (generation = 1) => {
    const thread = new ChatThread(info);
    thread.upsert({ id: 'turn-1', kind: 'turn', createdAt: 0, turnId: 'turn-1', state: 'running', endedAt: null, costUsd: 0 });
    let clock = 1;
    const projector = new ThreadProjector(thread, { providerName: 'Test CLI', now: () => clock++ });
    const project = (...events: BackendEvent[]) => events.flatMap((event) => projector.project(generation, event));
    return { thread, projector, project };
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

        project({ type: 'approval.withdrawn', requestId: 'r1' });
        expect(thread.get('approval-r1')).toMatchObject({ decision: 'cancelled' });
        expect(thread.info.status).toBe('running');
    });

    test('a question waits under its request id', () => {
        const { thread, project } = setup();
        const questions = [{ id: '0', header: 'Pick', question: 'Which?', choices: [{ label: 'A', description: '' }], multiSelect: false }];
        project({ type: 'question.requested', requestId: 'q1', questions });
        expect(thread.get('question-q1')).toMatchObject({ kind: 'question', state: 'pending', answers: null, questions });
        expect(thread.info.status).toBe('needs-you');
        project({ type: 'question.withdrawn', requestId: 'q1' });
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

    test('an exit of an idle chat is quiet', () => {
        const { thread, project } = setup();
        project({ type: 'turn.done', state: 'done', costUsd: 0 });
        project({ type: 'exit', exitCode: 0 });
        expect(thread.list().some((item) => item.kind === 'note')).toBe(false);
        expect(thread.info).toMatchObject({ running: false, status: 'idle' });
    });
});
