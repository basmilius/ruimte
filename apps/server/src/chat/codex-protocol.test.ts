import { describe, expect, test } from 'bun:test';
import { CodexProtocol, unwrapCommand } from './codex-protocol.ts';

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

describe('CodexProtocol', () => {
    test('the handshake answers the thread id and model; the turn id comes from turn/started', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.threadReady({ thread: { id: 'thread-abc', model: 'gpt-6-astra' }, model: 'gpt-6-astra never danger-full-access' })).toEqual([
            { type: 'session', agentSessionId: 'thread-abc', model: 'gpt-6-astra never danger-full-access' }
        ]);
        protocol.handle({ method: 'turn/started', params: { ...ids, turn: { id: 'ct1', status: 'inProgress' } } });
        expect(protocol.turnId).toBe('ct1');
    });

    test('an agent message opens on item/started, streams deltas and settles on item/completed', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: message('msg_1', '') } })).toEqual([
            { type: 'text.delta', ref: 'msg_1', text: '' }
        ]);
        expect(protocol.handle({ method: 'item/agentMessage/delta', params: { ...ids, itemId: 'msg_1', delta: 'po' } })).toEqual([
            { type: 'text.delta', ref: 'msg_1', text: 'po' }
        ]);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: message('msg_1', 'pong') } })).toEqual([
            { type: 'text.done', ref: 'msg_1', text: 'pong' }
        ]);
    });

    test('token usage carries the context window only when Codex reports one', () => {
        const protocol = new CodexProtocol(1);
        expect(
            protocol.handle({
                method: 'thread/tokenUsage/updated',
                params: { ...ids, tokenUsage: { total: { totalTokens: 50000 }, last: { totalTokens: 25090 }, modelContextWindow: 258400 } }
            })
        ).toEqual([{ type: 'usage', contextTokens: 25090, contextWindow: 258400 }]);
        expect(
            protocol.handle({ method: 'thread/tokenUsage/updated', params: { ...ids, tokenUsage: { last: { totalTokens: 30 }, modelContextWindow: null } } })
        ).toEqual([{ type: 'usage', contextTokens: 30 }]);
    });

    test('turn/completed reports how the turn ended', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.handle({ method: 'turn/completed', params: { ...ids, turn: { id: 'ct1', status: 'interrupted', error: null } } })).toEqual([
            { type: 'turn.done', state: 'aborted', costUsd: 0 }
        ]);
        expect(protocol.turnId).toBeNull();
        expect(
            protocol.handle({ method: 'turn/completed', params: { ...ids, turn: { id: 'ct1', status: 'failed', error: { message: 'overloaded' } } } })
        ).toEqual([{ type: 'turn.done', state: 'error', costUsd: 0, error: 'overloaded' }]);
    });

    test('a command is a Bash call whose partial output streams, and its approval carries the generation', () => {
        const protocol = new CodexProtocol(3);
        const command = { type: 'commandExecution', id: 'exec-1', command: '/bin/zsh -lc "git status"', cwd: '/w', status: 'inProgress' };
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: command } })).toEqual([
            { type: 'tool.started', ref: 'exec-1', name: 'Bash', input: { command: 'git status', cwd: '/w' }, parentRef: null }
        ]);
        expect(protocol.handle({ method: 'item/commandExecution/outputDelta', params: { ...ids, itemId: 'exec-1', delta: 'on main\n' } })).toEqual([
            { type: 'tool.output', ref: 'exec-1', text: 'on main\n' }
        ]);
        // Some builds send the bytes instead of the text.
        expect(protocol.handle({ method: 'item/commandExecution/outputDelta', params: { ...ids, itemId: 'exec-1', chunk: [111, 107] } })).toEqual([
            { type: 'tool.output', ref: 'exec-1', text: 'ok' }
        ]);

        const asked = protocol.handle({
            method: 'item/commandExecution/requestApproval',
            id: 0,
            params: {
                ...ids,
                itemId: 'exec-1',
                command: '/bin/zsh -lc "git status"',
                cwd: '/w',
                reason: 'Needs the repo',
                proposedExecpolicyAmendment: ['git']
            }
        });
        expect(asked).toEqual([
            {
                type: 'approval.requested',
                requestId: '3-0',
                ref: 'exec-1',
                toolName: 'Bash',
                input: { command: 'git status', cwd: '/w' },
                description: 'Needs the repo',
                canAllowAlways: true
            }
        ]);
        expect(protocol.approvalDecision('3-0', 'allow-always')).toEqual({
            rpcId: 0,
            result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git'] } } }
        });
        expect(protocol.approvalDecision('3-0', 'allow')).toBeNull();

        expect(
            protocol.handle({ method: 'item/completed', params: { ...ids, item: { ...command, status: 'completed', aggregatedOutput: 'clean\n' } } }).at(-1)
        ).toEqual({ type: 'tool.done', ref: 'exec-1', output: 'clean\n', state: 'done' });
    });

    test('a file change is one tool call with the unified diffs beside it, and its approval repeats them', () => {
        const protocol = new CodexProtocol(1);
        const changes = [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '-x\n+y\n' }];
        const patch = { type: 'fileChange', id: 'patch-1', changes, status: 'inProgress' };
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: patch } })).toEqual([
            {
                type: 'tool.started',
                ref: 'patch-1',
                name: 'ApplyPatch',
                input: { summary: 'a.ts' },
                parentRef: null,
                changes: [{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }]
            }
        ]);
        expect(protocol.handle({ method: 'item/fileChange/requestApproval', id: 4, params: { ...ids, itemId: 'patch-1', reason: null } })).toEqual([
            {
                type: 'approval.requested',
                requestId: '1-4',
                ref: 'patch-1',
                toolName: 'ApplyPatch',
                input: { summary: 'a.ts', changes: [{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }] },
                description: null,
                canAllowAlways: false
            }
        ]);
        // Codex takes no reason with a decline, and a file change it may write is remembered for the session.
        expect(protocol.approvalDecision('1-4', 'allow-always')).toMatchObject({ result: { decision: 'acceptForSession' } });

        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: { ...patch, status: 'failed' } } }).at(-1)).toMatchObject({
            type: 'tool.done',
            state: 'error',
            output: '-x\n+y\n',
            changes: [{ path: 'a.ts', kind: 'update' }]
        });
    });

    test('a collab agent call is a tool row, and spawning one reads as a delegation', () => {
        const protocol = new CodexProtocol(1);
        const item = {
            type: 'collabAgentToolCall',
            id: 'collab_1',
            tool: 'spawnAgent',
            prompt: 'Read the docs',
            model: 'gpt-6-astra',
            senderThreadId: 't1',
            receiverThreadIds: ['child-1'],
            agentsStates: {},
            status: 'inProgress'
        };
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item } })).toEqual([
            {
                type: 'tool.started',
                ref: 'collab_1',
                name: 'Agent',
                input: { tool: 'spawnAgent', prompt: 'Read the docs', model: 'gpt-6-astra', threads: ['child-1'] },
                parentRef: null
            }
        ]);

        const done = { ...item, status: 'completed', agentsStates: { 'child-1': { status: 'completed', message: 'the docs are read' } } };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: done } }).at(-1)).toEqual({
            type: 'tool.done',
            ref: 'collab_1',
            output: 'child-1: completed, the docs are read',
            state: 'done'
        });
    });

    test('a request Codex takes back is withdrawn', () => {
        const protocol = new CodexProtocol(1);
        protocol.handle({ method: 'item/fileChange/requestApproval', id: 3, params: { ...ids, itemId: 'patch-1', reason: null } });
        expect(protocol.handle({ method: 'serverRequest/resolved', params: { threadId: 't1', requestId: 3 } })).toEqual([
            { type: 'request.withdrawn', requestId: '1-3' }
        ]);
        expect(protocol.approvalDecision('1-3', 'allow')).toBeNull();
    });

    test('a blocking question keeps the ids Codex gave and is answered by reply', () => {
        const protocol = new CodexProtocol(1);
        expect(
            protocol.handle({
                method: 'item/tool/requestUserInput',
                id: 7,
                params: {
                    ...ids,
                    itemId: 'q',
                    isBlocking: true,
                    questions: [{ id: 'color', header: 'Choice', question: 'Which?', options: [{ label: 'Red', description: 'Warm' }] }]
                }
            })
        ).toEqual([
            {
                type: 'question.requested',
                requestId: '1-7',
                questions: [{ id: 'color', header: 'Choice', question: 'Which?', choices: [{ label: 'Red', description: 'Warm' }], multiSelect: false }]
            }
        ]);
        expect(protocol.questionAnswer('1-7', { color: 'Red' })).toEqual({ kind: 'respond', rpcId: 7, result: { answers: { color: { answers: ['Red'] } } } });
    });

    test('an agent message with questions is answered by steering, not shown as text', () => {
        const protocol = new CodexProtocol(1);
        const asked = message('call_1', 'Which?\n- Red\n- Blue', { delivery: 'async', questions: [{ title: 'Which?', options: ['Red', 'Blue'] }] });
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: asked } })).toEqual([]);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: asked } })).toEqual([
            {
                type: 'question.requested',
                requestId: 'call_1',
                questions: [
                    {
                        id: '0',
                        header: '',
                        question: 'Which?',
                        choices: [
                            { label: 'Red', description: '' },
                            { label: 'Blue', description: '' }
                        ],
                        multiSelect: false
                    }
                ]
            }
        ]);
        expect(protocol.questionAnswer('call_1', { '0': 'Red' })).toEqual({ kind: 'steer', text: 'Red' });
    });

    test('a server request it does not know says nothing, so the backend can refuse it', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.handle({ method: 'item/permissions/requestApproval', id: 9, params: ids })).toEqual([]);
    });

    test('a compaction item becomes a marker and an error becomes a note', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: { type: 'contextCompaction', id: 'cc-1' } } })).toEqual([
            { type: 'compaction', preTokens: null }
        ]);
        expect(protocol.handle({ method: 'error', params: { error: { message: 'stream stalled' }, willRetry: true } })).toEqual([
            { type: 'note', level: 'warning', text: 'stream stalled' }
        ]);
        expect(protocol.handle({ method: 'model/rerouted', params: { toModel: 'gpt-5.6-sol' } })).toEqual([{ type: 'model', model: 'gpt-5.6-sol' }]);
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
