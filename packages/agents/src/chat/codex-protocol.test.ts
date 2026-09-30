import { describe, expect, test } from 'bun:test';
import type { BackendEvent } from './backend.ts';
import { CodexProtocol, unwrapCommand } from './codex-protocol.ts';
import nativeApprovalCapture from './fixtures/codex-0.159.2-native-approval.json';
import nativeFileApprovalCapture from './fixtures/codex-0.159.2-native-file-approval.json';
import nativeInteractedCapture from './fixtures/codex-0.159.2-native-interacted.json';
import { ChatThread } from './thread.ts';
import { ThreadProjector } from './projector.ts';
import { codexProvider } from '../providers/codex-provider.ts';

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
    test('replays a real interacted child on its original row and thread, without duplicating completion or projecting foreign activity', () => {
        const protocol = new CodexProtocol(1);
        protocol.threadReady({ thread: { id: nativeInteractedCapture.rootThreadId } });
        const thread = new ChatThread({
            chatId: 'probe',
            provider: 'codex',
            cwd: '/tmp',
            agentSessionId: nativeInteractedCapture.rootThreadId,
            model: null,
            selection: codexProvider.catalog.normalize(undefined),
            runtimeMode: 'auto',
            running: true,
            status: 'running',
            activeTurnId: 'root-turn',
            slashCommands: [],
            usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
            createdAt: 1
        });
        const projector = new ThreadProjector(thread, { providerName: 'Codex' });
        let completed = 0;
        let restarted = 0;
        for (const frame of nativeInteractedCapture.frames) {
            for (const event of protocol.handle(frame)) {
                projector.project(1, event);
                if (event.type === 'task.done') {
                    completed++;
                }
                if (event.type === 'task.started' && event.resumed) {
                    restarted++;
                    expect(thread.list().filter((item) => item.kind === 'subagent')).toHaveLength(1);
                    expect(thread.list().find((item) => item.kind === 'subagent')).toMatchObject({
                        status: 'running',
                        turnId: 'root-turn',
                        finishedAt: null,
                        native: { threadId: frame.params.item.agentThreadId }
                    });
                }
            }
            expect(protocol.handle({ ...frame, params: { ...frame.params, threadId: 'unrelated-child' } })).toEqual([]);
        }
        expect(restarted).toBe(1);
        expect(completed).toBe(2);
        expect(thread.list().filter((item) => item.kind === 'subagent')).toHaveLength(1);
        expect(thread.list().find((item) => item.kind === 'subagent')).toMatchObject({ status: 'done', description: 'lifecycle_probe', turnId: 'root-turn' });
    });
    test('reports the effective approval policy and sandbox from the handshake', () => {
        for (const [effectiveRuntimeMode, approvalPolicy, sandbox] of [
            ['supervised', 'untrusted', 'readOnly'],
            ['auto-accept-edits', 'untrusted', 'workspaceWrite'],
            ['auto', 'on-request', 'workspaceWrite'],
            ['full-access', 'never', 'dangerFullAccess']
        ]) {
            expect(new CodexProtocol(1).threadReady({ thread: { id: 'root' }, approvalPolicy, sandbox: { type: sandbox } })[0]).toMatchObject({
                effectiveRuntimeMode,
                permissionMode: `${approvalPolicy} / ${sandbox}`
            });
        }
    });

    test('replays a real child file approval with its diff held across root completion', () => {
        const protocol = new CodexProtocol(1);
        protocol.threadReady({ thread: { id: nativeFileApprovalCapture.rootThreadId } });
        let approval: Extract<BackendEvent, { type: 'approval.requested' }> | undefined;
        for (const frame of nativeFileApprovalCapture.frames) {
            const events = protocol.handle(frame);
            approval ??= events.find((event) => event.type === 'approval.requested');
            if (frame.method === 'turn/completed' && frame.params.threadId === nativeFileApprovalCapture.rootThreadId) {
                expect(events.some((event) => event.type === 'request.withdrawn')).toBe(false);
                expect(approval).toMatchObject({
                    toolName: 'ApplyPatch',
                    description: 'Requested by subagent file_probe.',
                    input: { changes: [{ path: '<temporary-folder>/approval-probe.txt', kind: 'add', diff: 'sample\n' }] }
                });
                expect(protocol.approvalDecision(approval!.requestId, 'deny')).toEqual({ rpcId: 0, result: { decision: 'decline' } });
            }
        }
    });
    test('the handshake answers the thread id and model; the turn id comes from turn/started', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.threadReady({ thread: { id: 'thread-abc', model: 'gpt-6-astra' }, model: 'gpt-6-astra never danger-full-access' })).toEqual([
            { type: 'session', agentSessionId: 'thread-abc', model: 'gpt-6-astra never danger-full-access', title: null }
        ]);
        protocol.handle({ method: 'turn/started', params: { threadId: 'thread-abc', turn: { id: 'ct1', status: 'inProgress' } } });
        expect(protocol.turnId).toBe('ct1');
    });

    // Codex 0.156.1 streams a spawned agent's own thread over the chat's connection.
    test("a spawned agent's thread is none of the chat's: its turns, items and usage are left out", () => {
        const protocol = new CodexProtocol(1);
        protocol.threadReady({ thread: { id: 'main' }, model: 'm' });
        protocol.handle({ method: 'turn/started', params: { threadId: 'main', turn: { id: 'main-turn', status: 'inProgress' } } });
        const child = { threadId: 'child', turnId: 'child-turn' };
        expect(protocol.handle({ method: 'thread/started', params: { thread: { id: 'child' } } })).toEqual([]);
        expect(protocol.handle({ method: 'turn/started', params: { ...child, turn: { id: 'child-turn', status: 'inProgress' } } })).toEqual([]);
        expect(protocol.handle({ method: 'item/completed', params: { ...child, item: message('msg_child', 'PONG') } })).toEqual([]);
        expect(protocol.handle({ method: 'thread/tokenUsage/updated', params: { ...child, tokenUsage: { last: { totalTokens: 9 } } } })).toEqual([]);
        expect(protocol.handle({ method: 'turn/completed', params: { ...child, turn: { id: 'child-turn', status: 'completed' } } })).toEqual([]);
        expect(protocol.turnId).toBe('main-turn');
        expect(protocol.handle({ method: 'item/completed', params: { threadId: 'main', turnId: 'main-turn', item: message('msg_main', 'done') } })).toEqual([
            { type: 'text.done', ref: 'msg_main', text: 'done' }
        ]);
    });

    // What Codex 0.156.1 sends for a spawn, as captured from its app-server: no spawnAgent call, only these items.
    test('a spawned agent opens its row on its started activity and settles on its completed one, found by thread', () => {
        const protocol = new CodexProtocol(1);
        const activity = (id: string, kind: string) => ({ type: 'subAgentActivity', id, kind, agentThreadId: 'agent-thread', agentPath: '/root/pong' });
        const started = activity('call_spawn', 'started');
        const opened: BackendEvent[] = [
            { type: 'tool.started', ref: 'call_spawn', name: 'Agent', input: { agentPath: '/root/pong' }, parentRef: null },
            { type: 'task.started', ref: 'call_spawn', description: 'pong', subagentType: null, prompt: null, background: true, threadId: 'agent-thread' }
        ];
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: started } })).toEqual(opened);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: started } })).toEqual([]);

        // A wait on it completes with nothing to say about the agent itself.
        const wait = { type: 'collabAgentToolCall', id: 'call_wait', tool: 'wait', status: 'completed', receiverThreadIds: [], agentsStates: {} };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: wait } }).map((event) => event.type)).toEqual(['tool.started', 'tool.done']);

        const completed = activity('subagent-completed-turn-2', 'completed');
        expect(protocol.handle({ method: 'item/started', params: { ...ids, item: completed } })).toEqual([
            { type: 'task.done', ref: 'call_spawn', summary: null, ok: true }
        ]);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: completed } })).toEqual([]);
        // An activity about a thread nobody saw start has no row to settle.
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: { ...completed, agentThreadId: 'other' } } })).toEqual([]);
    });

    test('the name a thread already has comes with the handshake, and a rename after it as a title', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.threadReady({ thread: { id: 'thread-abc', name: ' Fix the\nbuild ' }, model: 'm' })).toEqual([
            { type: 'session', agentSessionId: 'thread-abc', model: 'm', title: 'Fix the build' }
        ]);
        expect(protocol.handle({ method: 'thread/name/updated', params: { threadId: 'thread-abc', threadName: 'Renamed' } })).toEqual([
            { type: 'title', title: 'Renamed' }
        ]);
        expect(protocol.handle({ method: 'thread/name/updated', params: { threadId: 'thread-abc' } })).toEqual([]);
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
            { type: 'turn.done', state: 'aborted', costUsd: 0, native: { turnId: 'ct1' } }
        ]);
        expect(protocol.turnId).toBeNull();
        expect(
            protocol.handle({ method: 'turn/completed', params: { ...ids, turn: { id: 'ct1', status: 'failed', error: { message: 'overloaded' } } } })
        ).toEqual([{ type: 'turn.done', state: 'error', costUsd: 0, error: 'overloaded', native: { turnId: 'ct1' } }]);
    });

    // The `codexErrorInfo` values of Codex 0.156.1 (`codex app-server generate-ts`, v2/CodexErrorInfo.ts).
    const failed = (protocol: CodexProtocol, codexErrorInfo: unknown): unknown[] =>
        protocol.handle({
            method: 'turn/completed',
            params: { ...ids, turn: { id: 'ct1', status: 'failed', error: { message: 'no', codexErrorInfo, additionalDetails: null } } }
        });

    test('a turn over the usage limit ends with the reset of the window its last update showed spent', () => {
        const protocol = new CodexProtocol(1);
        protocol.handle({
            method: 'account/rateLimits/updated',
            params: {
                rateLimits: {
                    limitId: 'codex',
                    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_789_000_000 },
                    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1_789_400_000 }
                }
            }
        });
        expect(failed(protocol, 'usageLimitExceeded')).toEqual([
            { type: 'turn.done', state: 'error', costUsd: 0, error: 'no', native: { turnId: 'ct1' }, limit: { kind: 'usage', resetsAt: 1_789_000_000_000 } }
        ]);
    });

    test('an overloaded server is an overload, and any other failure no limit at all', () => {
        const protocol = new CodexProtocol(1);
        expect(failed(protocol, 'usageLimitExceeded')).toMatchObject([{ limit: { kind: 'usage' } }]);
        expect(failed(protocol, 'serverOverloaded')).toMatchObject([{ limit: { kind: 'overload' } }]);
        expect(failed(protocol, 'rateLimitExceeded')).toMatchObject([{ limit: { kind: 'overload' } }]);
        expect(failed(protocol, 'contextWindowExceeded')).toEqual([{ type: 'turn.done', state: 'error', costUsd: 0, error: 'no', native: { turnId: 'ct1' } }]);
        expect(failed(protocol, { httpConnectionFailed: { httpStatusCode: 503 } })).toEqual([
            { type: 'turn.done', state: 'error', costUsd: 0, error: 'no', native: { turnId: 'ct1' } }
        ]);
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
                canAllowAlways: true,
                allowAlways: { label: 'Allow this command prefix', description: 'Allow future commands matching this prefix: ["git"]' }
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
            },
            {
                type: 'task.started',
                ref: 'collab_1',
                description: 'Read the docs',
                subagentType: null,
                prompt: 'Read the docs',
                background: true,
                threadId: 'child-1'
            },
            { type: 'task.progress', ref: 'collab_1', summary: null, lastTool: null, usage: null }
        ]);

        // The call completes as soon as the agent runs; that is no end of the agent.
        const launched = { ...item, status: 'completed', agentsStates: { 'child-1': { status: 'running', message: null } } };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: launched } }).at(-1)).toMatchObject({
            type: 'task.progress',
            ref: 'collab_1'
        });

        const done = { ...item, status: 'completed', agentsStates: { 'child-1': { status: 'completed', message: 'the docs are read' } } };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: done } }).at(-1)).toEqual({
            type: 'task.done',
            ref: 'collab_1',
            summary: 'child-1: completed, the docs are read',
            ok: true
        });

        const sendInput = { ...item, id: 'collab_2', tool: 'sendInput', status: 'completed' };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: sendInput } }).at(-1)).toMatchObject({
            type: 'tool.done',
            ref: 'collab_2',
            state: 'done'
        });

        // Another call that reports on a spawned agent settles its row, once.
        const second = { ...item, id: 'collab_3', status: 'completed', receiverThreadIds: ['child-2'], agentsStates: { 'child-2': { status: 'running' } } };
        protocol.handle({ method: 'item/completed', params: { ...ids, item: second } });
        const wait = {
            ...item,
            id: 'collab_4',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: ['child-2'],
            agentsStates: { 'child-2': { status: 'errored' } }
        };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: wait } }).at(-1)).toEqual({
            type: 'task.done',
            ref: 'collab_3',
            summary: 'child-2: errored',
            ok: false
        });
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: { ...wait, id: 'collab_5' } } }).at(-1)).toMatchObject({
            type: 'tool.done'
        });

        // A spawn that failed opened no agent, so nothing is left to wait for.
        const failed = { ...item, id: 'collab_6', status: 'failed', receiverThreadIds: [] };
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: failed } }).at(-1)).toEqual({
            type: 'task.done',
            ref: 'collab_6',
            summary: null,
            ok: false
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

    test('a request still open as the turn completes is withdrawn with it', () => {
        const protocol = new CodexProtocol(1);
        protocol.handle({ method: 'item/fileChange/requestApproval', id: 4, params: { ...ids, itemId: 'patch-2', reason: null } });
        expect(protocol.handle({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'ct1', status: 'completed' } } })).toEqual([
            { type: 'request.withdrawn', requestId: '1-4' },
            { type: 'turn.done', state: 'done', costUsd: 0, native: { turnId: 'ct1' } }
        ]);
        expect(protocol.approvalDecision('1-4', 'allow')).toBeNull();
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
                ],
                async: true
            }
        ]);
        expect(protocol.questionAnswer('call_1', { '0': 'Red' })).toEqual({ kind: 'steer', text: 'Red' });
    });

    test('an async question can be dismissed, a blocking one cannot', () => {
        const protocol = new CodexProtocol(1);
        const asked = message('call_2', 'Which?', { delivery: 'async', questions: [{ title: 'Which?', options: ['Red'] }] });
        protocol.handle({ method: 'item/started', params: { ...ids, item: asked } });
        protocol.handle({ method: 'item/completed', params: { ...ids, item: asked } });
        protocol.handle({
            method: 'thread/requestUserInput',
            id: 7,
            params: { ...ids, questions: [{ id: 'color', header: 'Choice', question: 'Which color?', options: [{ label: 'Red', description: '' }] }] }
        });
        expect(protocol.dismissQuestion('1-7')).toBe(false);
        expect(protocol.dismissQuestion('call_2')).toBe(true);
        expect(protocol.dismissQuestion('call_2')).toBe(false);
        expect(protocol.questionAnswer('call_2', { '0': 'Red' })).toBeNull();
    });

    test('an MCP server that asks yes or no is an approval, answered with how long Codex remembers it', () => {
        const protocol = new CodexProtocol(2);
        // As computer use sends it before it touches an app (Codex 0.156.1).
        const params = {
            ...ids,
            serverName: 'cua_repl',
            mode: 'form',
            message: 'Allow Computer Use to use "Ruimte"?',
            requestedSchema: { type: 'object', properties: {} },
            _meta: {
                callId: 'call_1',
                codex_approval_kind: 'mcp_tool_call',
                connector_name: 'Computer Use',
                persist: ['session', 'always'],
                tool_name: 'get_app_state',
                tool_params_display: [{ display_name: 'App', name: 'app', value: 'Ruimte' }]
            }
        };
        expect(protocol.handle({ method: 'mcpServer/elicitation/request', id: 0, params })).toEqual([
            {
                type: 'approval.requested',
                requestId: '2-0',
                ref: 'call_1',
                toolName: 'Computer Use',
                input: { app: 'Ruimte' },
                description: 'Allow Computer Use to use "Ruimte"?',
                canAllowAlways: true,
                allowAlways: { label: 'Always allow', description: 'Codex remembers this approval, also in later chats.' }
            }
        ]);
        expect(protocol.approvalDecision('2-0', 'allow-always')).toEqual({ rpcId: 0, result: { action: 'accept', content: {}, _meta: { persist: 'always' } } });
        expect(protocol.approvalDecision('2-0', 'allow')).toBeNull();

        protocol.handle({ method: 'mcpServer/elicitation/request', id: 1, params: { ...params, _meta: { ...params._meta, persist: ['session'] } } });
        expect(protocol.approvalDecision('2-1', 'allow')).toEqual({ rpcId: 1, result: { action: 'accept', content: {} } });

        protocol.handle({ method: 'mcpServer/elicitation/request', id: 2, params: { ...params, _meta: {} } });
        expect(protocol.approvalDecision('2-2', 'deny')).toEqual({ rpcId: 2, result: { action: 'decline' } });
    });

    test('an MCP server that asks for fields or sends a link is left to the backend to refuse', () => {
        const protocol = new CodexProtocol(1);
        const form = { ...ids, serverName: 's', mode: 'form', message: 'Name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } };
        expect(protocol.handle({ method: 'mcpServer/elicitation/request', id: 0, params: form })).toEqual([]);
        const link = { ...ids, serverName: 's', mode: 'url', message: 'Sign in', url: 'https://example.com', elicitationId: 'e1' };
        expect(protocol.handle({ method: 'mcpServer/elicitation/request', id: 1, params: link })).toEqual([]);
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

describe('reasoning', () => {
    test('summary and text deltas stream as thinking, with a break between summary parts', () => {
        const protocol = new CodexProtocol(1);
        expect(protocol.handle({ method: 'item/reasoning/summaryTextDelta', params: { itemId: 'r1', delta: 'weighing' } })).toEqual([
            { type: 'thinking.delta', ref: 'r1', text: 'weighing' }
        ]);
        expect(protocol.handle({ method: 'item/reasoning/summaryPartAdded', params: { itemId: 'r1', summaryIndex: 1 } })).toEqual([
            { type: 'thinking.delta', ref: 'r1', text: '\n\n' }
        ]);
        // The first part needs no break in front of it.
        expect(protocol.handle({ method: 'item/reasoning/summaryPartAdded', params: { itemId: 'r1', summaryIndex: 0 } })).toEqual([]);
        expect(protocol.handle({ method: 'item/reasoning/textDelta', params: { itemId: 'r1', delta: 'the details' } })).toEqual([
            { type: 'thinking.delta', ref: 'r1', text: 'the details' }
        ]);
    });

    test('a completed reasoning item carries the whole thing, for a client that missed the deltas', () => {
        const protocol = new CodexProtocol(1);
        expect(
            protocol.handle({ method: 'item/completed', params: { item: { type: 'reasoning', id: 'r1', summary: ['first', ''], content: ['second'] } } })
        ).toEqual([{ type: 'thinking.done', ref: 'r1', text: 'first\n\nsecond' }]);
        // Nothing to say while it is still running, and nothing to say about an empty one.
        expect(protocol.handle({ method: 'item/started', params: { item: { type: 'reasoning', id: 'r2', summary: [], content: [] } } })).toEqual([]);
        expect(protocol.handle({ method: 'item/completed', params: { item: { type: 'reasoning', id: 'r2', summary: [], content: [] } } })).toEqual([]);
    });
});

describe('rate limits', () => {
    test('what a turn says about the plan leaves the chat as a limits event', () => {
        const protocol = new CodexProtocol(0);
        const params = { rateLimits: { limitId: 'codex', planType: 'pro', primary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: 1_789_453_149 } } };
        expect(protocol.handle({ method: 'account/rateLimits/updated', params })).toEqual([
            {
                type: 'limits',
                update: {
                    kind: 'codex',
                    plan: 'pro',
                    windows: [{ id: 'primary', kind: 'weekly', label: 'Weekly', used: 0.96, resetsAt: 1_789_453_149_000, durationMs: 604_800_000 }]
                }
            }
        ]);
    });

    test('the budget of one model is not the plan', () => {
        const protocol = new CodexProtocol(0);
        expect(
            protocol.handle({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex_spark', primary: { usedPercent: 3 } } } })
        ).toEqual([]);
    });

    test('a terminal session still open when the turn ends runs on in the background until its item completes', () => {
        const protocol = new CodexProtocol(1);
        const command = (status: string) => ({
            type: 'commandExecution',
            id: 'exec-bg',
            command: "/bin/zsh -lc 'bun run dev'",
            cwd: '/w',
            processId: '44653',
            source: 'unifiedExecStartup',
            status,
            aggregatedOutput: status === 'inProgress' ? null : 'ready\n'
        });
        protocol.handle({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'ct1' } } });
        protocol.handle({ method: 'item/started', params: { ...ids, item: command('inProgress') } });
        expect(protocol.handle({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'ct1', status: 'completed' } } })).toEqual([
            { type: 'background.started', taskId: '44653', ref: 'exec-bg', monitor: false, description: null },
            { type: 'turn.done', state: 'done', costUsd: 0, native: { turnId: 'ct1' } }
        ]);
        expect(protocol.handle({ method: 'item/completed', params: { ...ids, item: command('failed') } })).toEqual([
            { type: 'tool.done', ref: 'exec-bg', output: 'ready\n', state: 'error' },
            { type: 'background.ended', taskId: '44653' }
        ]);
    });

    test('a command that ended inside its turn never reaches the background', () => {
        const protocol = new CodexProtocol(1);
        const command = { type: 'commandExecution', id: 'exec-2', command: 'ls', cwd: '/w', processId: '1', status: 'inProgress' };
        protocol.handle({ method: 'item/started', params: { ...ids, item: command } });
        protocol.handle({ method: 'item/completed', params: { ...ids, item: { ...command, status: 'completed', aggregatedOutput: '' } } });
        expect(protocol.handle({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'ct1', status: 'completed' } } })).toEqual([
            { type: 'turn.done', state: 'done', costUsd: 0, native: { turnId: 'ct1' } }
        ]);
    });
});

describe('native child approval ownership', () => {
    test('replays the live Codex 0.159.2 child approval held across root completion', () => {
        const protocol = new CodexProtocol(1);
        protocol.threadReady({ thread: { id: nativeApprovalCapture.rootThreadId } });
        let requestId: string | null = null;
        let rpcId: number | string | null = null;
        for (const frame of nativeApprovalCapture.frames) {
            const events = protocol.handle(frame);
            const approval = events.find((event) => event.type === 'approval.requested');
            if (approval?.type === 'approval.requested') {
                requestId = approval.requestId;
                rpcId = frame.id!;
                expect(approval.description).toContain('approval_probe');
            }
            if (frame.method === 'turn/completed' && frame.params.threadId === nativeApprovalCapture.rootThreadId) {
                expect(requestId).not.toBeNull();
                expect(rpcId).not.toBeNull();
                expect(events.some((event) => event.type === 'request.withdrawn')).toBe(false);
                expect(protocol.approvalDecision(requestId!, 'deny')).toEqual({ rpcId: rpcId!, result: { decision: 'decline' } });
            }
        }
        expect(protocol.approvalDecision(requestId!, 'allow')).toBeNull();
    });

    const child = { threadId: 'child', turnId: 'child-turn', itemId: 'patch' };
    const request = (protocol: CodexProtocol, id = 9) => protocol.handle({ id, method: 'item/fileChange/requestApproval', params: child });
    const ready = () => {
        const protocol = new CodexProtocol(1);
        protocol.threadReady({ thread: { id: 'root' } });
        return protocol;
    };

    test('keeps a child diff without projecting child output into the root thread', () => {
        const protocol = ready();
        expect(
            protocol.handle({
                method: 'item/started',
                params: {
                    ...child,
                    item: { type: 'fileChange', id: 'patch', changes: [{ path: 'child.ts', kind: 'update', diff: '-old\n+new' }], status: 'inProgress' }
                }
            })
        ).toEqual([]);
        expect(protocol.handle({ method: 'item/agentMessage/delta', params: { ...child, delta: 'child text' } })).toEqual([]);
        expect(request(protocol)[0]).toMatchObject({
            type: 'approval.requested',
            input: {
                changes: [{ path: 'child.ts', kind: 'update', diff: '-old\n+new' }]
            }
        });
        expect(request(protocol, 10)[0]).toMatchObject({ description: expect.stringContaining('child') });
    });

    test('names the child in its approval and closes only requests owned by the closing thread', () => {
        const protocol = ready();
        protocol.handle({
            method: 'item/started',
            params: { threadId: 'root', item: { type: 'subAgentActivity', id: 'spawn', kind: 'started', agentThreadId: 'child', agentPath: '/root/Reviewer' } }
        });
        expect(request(protocol)[0]).toMatchObject({ description: 'Requested by subagent Reviewer.' });
        protocol.handle({ id: 10, method: 'item/fileChange/requestApproval', params: { threadId: 'root', turnId: 'root-turn', itemId: 'root-patch' } });
        expect(protocol.handle({ method: 'thread/closed', params: { threadId: 'root' } })).toEqual([{ type: 'request.withdrawn', requestId: '1-10' }]);
        expect(protocol.approvalDecision('1-9', 'allow')).toEqual({ rpcId: 9, result: { decision: 'accept' } });
    });

    test('root completion cannot withdraw a child request, but its own turn can', () => {
        const protocol = ready();
        request(protocol);
        const root = protocol.handle({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'root-turn', status: 'completed' } } });
        expect(root.some((event) => event.type === 'request.withdrawn')).toBe(false);
        expect(protocol.approvalDecision('1-9', 'allow')).toEqual({ rpcId: 9, result: { decision: 'accept' } });
        expect(protocol.approvalDecision('1-9', 'allow')).toBeNull();
        request(protocol, 10);
        const ended = protocol.handle({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-turn', status: 'completed' } } });
        expect(ended).toEqual([{ type: 'request.withdrawn', requestId: '1-10' }]);
        expect(protocol.approvalDecision('1-10', 'allow')).toBeNull();
    });

    test('another turn of the same child leaves the owner turn waiting', () => {
        const protocol = ready();
        request(protocol);
        protocol.handle({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'other', status: 'completed' } } });
        expect(protocol.approvalDecision('1-9', 'deny')).toEqual({ rpcId: 9, result: { decision: 'decline' } });
    });

    test('a child withdrawal and process exit both end its request', () => {
        const protocol = ready();
        request(protocol);
        expect(protocol.handle({ method: 'serverRequest/resolved', params: { threadId: 'child', requestId: 9 } })).toEqual([
            { type: 'request.withdrawn', requestId: '1-9' }
        ]);
        expect(protocol.approvalDecision('1-9', 'allow')).toBeNull();
        request(protocol, 10);
        protocol.forgetPending();
        expect(protocol.approvalDecision('1-10', 'allow')).toBeNull();
    });
});

test('approval metadata is scoped by thread, cleared by owner completion and bounded between completions', () => {
    const protocol = new CodexProtocol(1);
    protocol.threadReady({ thread: { id: 'root' } });
    const patch = (threadId: string, itemId: string, path: string) =>
        protocol.handle({
            method: 'item/started',
            params: {
                threadId,
                turnId: 'turn',
                item: { type: 'fileChange', id: itemId, changes: [{ path, kind: 'update', diff: '-x\n+y' }] }
            }
        });
    const approval = (id: number, threadId: string, itemId: string) =>
        protocol.handle({ id, method: 'item/fileChange/requestApproval', params: { threadId, turnId: 'turn', itemId } })[0];
    patch('child', 'same', 'child.ts');
    patch('root', 'same', 'root.ts');
    expect(approval(1, 'child', 'same')).toMatchObject({ input: { summary: 'child.ts' } });
    expect(approval(2, 'root', 'same')).toMatchObject({ input: { summary: 'root.ts' } });
    protocol.handle({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'turn', status: 'completed' } } });
    expect(approval(3, 'child', 'same')).toMatchObject({ input: { changes: [] } });
    for (let i = 0; i < 600; i++) {
        patch('child', `patch-${i}`, `file-${i}.ts`);
    }
    expect(approval(4, 'child', 'patch-0')).toMatchObject({ input: { changes: [] } });
    expect(approval(5, 'child', 'patch-599')).toMatchObject({ input: { summary: 'file-599.ts' } });
    protocol.forgetPending();
    expect(approval(6, 'child', 'patch-599')).toMatchObject({ input: { changes: [] } });
});

test('Stop declines a child request and its runtime closing withdraws another', () => {
    const protocol = new CodexProtocol(1);
    protocol.threadReady({ thread: { id: 'root' } });
    const request = (id: number) =>
        protocol.handle({ id, method: 'item/commandExecution/requestApproval', params: { threadId: 'child', turnId: 'turn', command: 'example' } });
    request(1);
    expect(protocol.declineRequest('1-1')).toEqual({ rpcId: 1, result: { decision: 'decline' } });
    expect(protocol.approvalDecision('1-1', 'allow')).toBeNull();
    request(2);
    expect(protocol.handle({ method: 'thread/closed', params: { threadId: 'child' } })).toEqual([{ type: 'request.withdrawn', requestId: '1-2' }]);
    expect(protocol.approvalDecision('1-2', 'allow')).toBeNull();
});
