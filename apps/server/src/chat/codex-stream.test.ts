import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/contracts';
import { CodexStreamReducer, unwrapCommand } from './codex-stream.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    provider: 'codex',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'gpt-6-astra', options: { effort: 'medium' } },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    status: 'running',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
};

const setup = () => {
    const thread = new ChatThread(info);
    thread.upsert({ id: 'turn-1', kind: 'turn', createdAt: 0, turnId: 'turn-1', state: 'running', endedAt: null, costUsd: 0 });
    let clock = 1;
    const reducer = new CodexStreamReducer(thread, () => clock++);
    reducer.nextProcess();
    return { thread, reducer };
};

const ids = { threadId: 't1', turnId: 'ct1' };

const message = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
    type: 'agentMessage',
    id,
    text,
    phase: 'final_answer',
    memoryCitation: null,
    delivery: null,
    questions: null,
    ...extra
});

describe('CodexStreamReducer', () => {
    test('thread/start answers the thread id and model; the turn id comes from turn/started', () => {
        const { thread, reducer } = setup();
        reducer.threadReady({ thread: { id: 'thread-abc', model: 'gpt-6-astra' }, model: 'gpt-6-astra' });
        expect(thread.info).toMatchObject({ agentSessionId: 'thread-abc', model: 'gpt-6-astra', running: true });
        reducer.handle({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'ct1', status: 'inProgress' } } });
        expect(reducer.turnId).toBe('ct1');
    });

    test('an agent message streams through deltas and settles on item/completed', () => {
        const { thread, reducer } = setup();
        const started = reducer.handle({ method: 'item/started', params: { ...ids, item: message('msg_1', '') } });
        expect(started.events[0]).toMatchObject({ type: 'item', item: { id: 'msg_1', kind: 'assistant', text: '', streaming: true, turnId: 'turn-1' } });
        const delta = reducer.handle({ method: 'item/agentMessage/delta', params: { ...ids, itemId: 'msg_1', delta: 'po' } });
        expect(delta.events).toEqual([{ type: 'delta', itemId: 'msg_1', text: 'po' }]);
        reducer.handle({ method: 'item/agentMessage/delta', params: { ...ids, itemId: 'msg_1', delta: 'ng' } });
        reducer.handle({ method: 'item/completed', params: { ...ids, item: message('msg_1', 'pong') } });
        expect(thread.get('msg_1')).toMatchObject({ kind: 'assistant', text: 'pong', streaming: false });

        const out = reducer.handle({
            method: 'thread/tokenUsage/updated',
            params: { ...ids, tokenUsage: { total: { totalTokens: 50000 }, last: { totalTokens: 25090, inputTokens: 25085 }, modelContextWindow: 258400 } }
        });
        expect(out.events[0]).toMatchObject({ type: 'info', info: { usage: { contextTokens: 25090, contextWindow: 258400 } } });
    });

    test('turn/completed closes the turn by its status and counts it', () => {
        const { thread, reducer } = setup();
        reducer.handle({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'ct1' } } });
        reducer.handle({ method: 'item/started', params: { ...ids, item: message('msg_1', '') } });
        reducer.handle({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'ct1', status: 'interrupted', error: null } } });
        expect(thread.get('turn-1')).toMatchObject({ state: 'aborted', endedAt: expect.any(Number) });
        expect(thread.get('msg_1')).toMatchObject({ streaming: false });
        expect(thread.info).toMatchObject({ status: 'idle', activeTurnId: null, usage: { turns: 1 } });
        expect(reducer.turnId).toBeNull();
    });

    test('a failed turn leaves an error note', () => {
        const { thread, reducer } = setup();
        reducer.handle({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'ct1', status: 'failed', error: { message: 'overloaded' } } } });
        expect(thread.list().filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ level: 'error', text: 'overloaded' })]);
        expect(thread.get('turn-1')).toMatchObject({ state: 'error' });
    });

    test('a command becomes a Bash tool item; the approval request carries the process generation in its id', () => {
        const { thread, reducer } = setup();
        const command = {
            type: 'commandExecution',
            id: 'exec-1',
            command: '/bin/zsh -lc "git status"',
            cwd: '/w',
            status: 'inProgress',
            aggregatedOutput: null,
            exitCode: null
        };
        reducer.handle({ method: 'item/started', params: { ...ids, item: command } });
        expect(thread.get('exec-1')).toMatchObject({ kind: 'tool', name: 'Bash', input: { command: 'git status', cwd: '/w' }, state: 'running', output: null });

        const out = reducer.handle({
            method: 'item/commandExecution/requestApproval',
            id: 0,
            params: {
                ...ids,
                itemId: 'exec-1',
                command: '/bin/zsh -lc "git status"',
                cwd: '/w',
                reason: 'Needs the repo',
                proposedExecpolicyAmendment: ['git', 'status']
            }
        });
        expect(out.actions).toEqual([{ type: 'approval', requestId: '1-0', rpcId: 0, kind: 'command', amendment: ['git', 'status'], decisions: [] }]);
        expect(thread.get('approval-1-0')).toMatchObject({
            kind: 'approval',
            requestId: '1-0',
            toolUseId: 'exec-1',
            toolName: 'Bash',
            input: { command: 'git status' },
            description: 'Needs the repo',
            canAllowAlways: true,
            decision: 'pending'
        });
        expect(thread.info.status).toBe('needs-you');

        reducer.handle({ method: 'item/completed', params: { ...ids, item: { ...command, status: 'completed', aggregatedOutput: 'clean\n', exitCode: 0 } } });
        expect(thread.get('exec-1')).toMatchObject({ state: 'done', output: 'clean\n' });
    });

    test('serverRequest/resolved cancels an approval that still waits', () => {
        const { thread, reducer } = setup();
        reducer.handle({ method: 'item/fileChange/requestApproval', id: 3, params: { ...ids, itemId: 'patch-1', reason: null } });
        expect(thread.get('approval-1-3')).toMatchObject({ toolName: 'ApplyPatch', canAllowAlways: false, decision: 'pending' });
        reducer.handle({ method: 'serverRequest/resolved', params: { threadId: 't1', requestId: 3 } });
        expect(thread.get('approval-1-3')).toMatchObject({ decision: 'cancelled' });
        expect(thread.info.status).toBe('running');
    });

    test('a file change is one tool item with the diffs as output', () => {
        const { thread, reducer } = setup();
        const patch = {
            type: 'fileChange',
            id: 'patch-1',
            changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '-x\n+y\n' }],
            status: 'inProgress'
        };
        reducer.handle({ method: 'item/started', params: { ...ids, item: patch } });
        expect(thread.get('patch-1')).toMatchObject({ kind: 'tool', name: 'ApplyPatch', input: { summary: 'a.ts' }, state: 'running' });
        reducer.handle({ method: 'item/completed', params: { ...ids, item: { ...patch, status: 'failed' } } });
        expect(thread.get('patch-1')).toMatchObject({ state: 'error', output: '-x\n+y\n' });
    });

    test('a blocking question keeps the question ids Codex gave', () => {
        const { thread, reducer } = setup();
        const out = reducer.handle({
            method: 'item/tool/requestUserInput',
            id: 7,
            params: {
                ...ids,
                itemId: 'q',
                isBlocking: true,
                questions: [
                    { id: 'color', header: 'Choice', question: 'Which?', isOther: false, isSecret: false, options: [{ label: 'Red', description: 'Warm' }] }
                ]
            }
        });
        expect(out.actions).toEqual([{ type: 'question', requestId: '1-7', rpcId: 7 }]);
        expect(thread.get('question-1-7')).toMatchObject({
            kind: 'question',
            state: 'pending',
            questions: [{ id: 'color', header: 'Choice', question: 'Which?', choices: [{ label: 'Red', description: 'Warm' }], multiSelect: false }]
        });
    });

    test('an agent message with questions is a question answered by steering, not an assistant item', () => {
        const { thread, reducer } = setup();
        const asked = message('call_1', 'Which?\n- Red\n- Blue', { delivery: 'async', questions: [{ title: 'Which?', options: ['Red', 'Blue'] }] });
        expect(reducer.handle({ method: 'item/started', params: { ...ids, item: asked } }).events).toEqual([]);
        const out = reducer.handle({ method: 'item/completed', params: { ...ids, item: asked } });
        expect(out.actions).toEqual([{ type: 'question', requestId: 'call_1', rpcId: null }]);
        expect(thread.get('question-call_1')).toMatchObject({ questions: [{ id: '0', question: 'Which?', choices: [{ label: 'Red' }, { label: 'Blue' }] }] });
        expect(thread.get('call_1')).toBeUndefined();
        expect(thread.info.status).toBe('needs-you');
    });

    test('an unknown server request produces no action, so the session can refuse it', () => {
        const { reducer } = setup();
        expect(reducer.handle({ method: 'item/permissions/requestApproval', id: 9, params: ids }).actions).toEqual([]);
    });

    test('a compaction item becomes a marker with the tokens before it', () => {
        const { thread, reducer } = setup();
        reducer.handle({ method: 'thread/tokenUsage/updated', params: { ...ids, tokenUsage: { last: { totalTokens: 5000 }, modelContextWindow: null } } });
        reducer.handle({ method: 'item/completed', params: { ...ids, item: { type: 'contextCompaction', id: 'cc-1' } } });
        expect(thread.get('compaction-cc-1')).toMatchObject({ kind: 'compaction', preTokens: 5000 });
    });

    test('finish settles open items and reports the exit when the turn was running', () => {
        const { thread, reducer } = setup();
        reducer.handle({ method: 'item/started', params: { ...ids, item: message('msg_1', '') } });
        reducer.handle({ method: 'item/commandExecution/requestApproval', id: 0, params: { ...ids, itemId: 'exec-1', command: 'ls' } });
        reducer.finish(1);
        expect(thread.get('msg_1')).toMatchObject({ streaming: false });
        expect(thread.get('approval-1-0')).toMatchObject({ decision: 'cancelled' });
        expect(thread.get('turn-1')).toMatchObject({ state: 'error' });
        expect(thread.list().filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ level: 'error', text: 'Codex exited with code 1' })]);
        expect(thread.info).toMatchObject({ running: false, status: 'error', activeTurnId: null });
    });
});

describe('unwrapCommand', () => {
    test('drops the login shell wrapper and its quotes', () => {
        expect(unwrapCommand('/bin/zsh -lc date')).toBe('date');
        expect(unwrapCommand('/bin/zsh -lc "printf \'hello\' > hello.txt"')).toBe("printf 'hello' > hello.txt");
        expect(unwrapCommand("bash -lc 'ls -la'")).toBe('ls -la');
        expect(unwrapCommand('python3 script.py')).toBe('python3 script.py');
    });
});
