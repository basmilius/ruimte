/*
 * Stands in for `codex app-server` in tests: the same JSON-RPC methods and notifications, no
 * network. `tool: <cmd>` asks approval for a command, `edit: <path>` for a file change, `ask: <q>`
 * asks a blocking question, `async: <q>` asks through an agent message and waits for a steer,
 * `slow` waits for an interrupt, `fail` ends the turn failed, `crash` exits with 1, `note?` answers with
 * what Ruimte put in front of the first prompt. Resuming a thread whose id starts with `named-` finds
 * it named, `thread/name/set` renames it and says so, and `name?` answers with that name. The thread echoes the
 * model and the sandbox it was started with, so a test can see what a session asked for.
 */
import { VERBS_NOTE } from '../context/context-note.ts';
import { runOverStdio, type FakeCli } from './fake-cli.ts';

type Frame = Record<string, unknown>;

type PendingApproval = { rpcId: number; entry: Frame; kind: 'command' | 'fileChange' };

export const fakeCodex: FakeCli = (io) => {
    const out = io.out;

    let serverRequestId = 0;
    let itemCounter = 0;
    let threadId = '';
    let threadModel = 'fake-model';
    let threadName: string | null = null;
    let threadSandbox = '';
    let threadApproval = '';
    let turnId = '';
    let turnEffort: string | null = null;
    let firstPromptNote: string | null = null;

    const notify = (method: string, params: unknown): void => {
        out({ method, params, emittedAtMs: Date.now() });
    };

    // Codex item ids are unique across processes (UUIDs and response ids); a nonce keeps the fake honest.
    const nonce = Math.random().toString(36).slice(2, 6);

    const item = (type: string, fields: Frame): Frame => ({ type, id: `${type}-${nonce}-${++itemCounter}`, ...fields });

    const started = (entry: Frame): void => {
        notify('item/started', { item: entry, threadId, turnId, startedAtMs: Date.now() });
    };

    const completed = (entry: Frame): void => {
        notify('item/completed', { item: entry, threadId, turnId, completedAtMs: Date.now() });
    };

    const usage = (): void => {
        notify('thread/tokenUsage/updated', {
            threadId,
            turnId,
            tokenUsage: {
                total: {
                    totalTokens: 25090,
                    inputTokens: 25085,
                    cachedInputTokens: 12928,
                    cacheWriteInputTokens: 0,
                    outputTokens: 5,
                    reasoningOutputTokens: 0
                },
                last: { totalTokens: 25090, inputTokens: 25085, cachedInputTokens: 12928, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 },
                modelContextWindow: 258400
            }
        });
    };

    const agentMessage = (text: string): void => {
        const entry = item('agentMessage', { text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null });
        started(entry);
        const half = Math.ceil(text.length / 2);
        notify('item/agentMessage/delta', { threadId, turnId, itemId: entry.id, delta: text.slice(0, half) });
        notify('item/agentMessage/delta', { threadId, turnId, itemId: entry.id, delta: text.slice(half) });
        completed({ ...entry, text });
    };

    const turnStarted = (): void => {
        turnId = `turn-${++itemCounter}`;
        notify('thread/status/changed', { threadId, status: { type: 'active', activeFlags: [] } });
        notify('turn/started', { threadId, turn: { id: turnId, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null } });
    };

    const turnCompleted = (status: 'completed' | 'interrupted' | 'failed', error: string | null = null): void => {
        usage();
        notify('thread/status/changed', { threadId, status: { type: 'idle' } });
        notify('turn/completed', {
            threadId,
            turn: {
                id: turnId,
                items: [],
                itemsView: 'summary',
                status,
                error: error ? { message: error, codexErrorInfo: null, additionalDetails: null } : null
            }
        });
        turnId = '';
    };

    let pendingApproval: PendingApproval | null = null;
    let pendingQuestion: { rpcId: number; questionId: string } | null = null;
    let pendingSteer = false;
    let slow = false;

    const askApproval = (kind: 'command' | 'fileChange', entry: Frame, params: Frame): void => {
        pendingApproval = { rpcId: serverRequestId, entry, kind };
        notify('thread/status/changed', { threadId, status: { type: 'active', activeFlags: ['waitingOnApproval'] } });
        out({
            method: kind === 'command' ? 'item/commandExecution/requestApproval' : 'item/fileChange/requestApproval',
            id: serverRequestId++,
            params: { threadId, turnId, itemId: entry.id, startedAtMs: Date.now(), ...params }
        });
    };

    const handleTurnStart = (params: Frame): void => {
        turnEffort = typeof params.effort === 'string' ? params.effort : null;
        const input = Array.isArray(params.input) ? (params.input[0] as { text?: string } | undefined) : undefined;
        const raw = input?.text ?? '';
        // Codex has no system prompt, so Ruimte puts its note in front of the first prompt; `note?` asks for it back.
        const noted = raw.startsWith(`${VERBS_NOTE}\n\n`);
        if (noted) {
            firstPromptNote = VERBS_NOTE;
        }
        const text = noted ? raw.slice(VERBS_NOTE.length + 2) : raw;
        if (text === 'name?') {
            turnStarted();
            agentMessage(threadName ?? 'unnamed');
            turnCompleted('completed');
            return;
        }
        if (text === 'note?') {
            turnStarted();
            agentMessage(firstPromptNote ?? 'nothing');
            turnCompleted('completed');
            return;
        }
        turnStarted();
        const user = item('userMessage', { clientId: null, content: [{ type: 'text', text, text_elements: [] }] });
        started(user);
        completed(user);
        if (text === 'crash') {
            io.exit(1);
            return;
        }
        if (text === 'fail') {
            turnCompleted('failed', 'The model is overloaded');
            return;
        }
        if (text === 'slow') {
            slow = true;
            started(item('agentMessage', { text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null }));
            return;
        }
        if (text.startsWith('tool:')) {
            const command = text.slice(5).trim();
            const entry = item('commandExecution', {
                command: `/bin/zsh -lc ${command}`,
                cwd: io.cwd,
                status: 'inProgress',
                aggregatedOutput: null,
                exitCode: null
            });
            started(entry);
            askApproval('command', entry, {
                kind: 'command',
                command: `/bin/zsh -lc ${command}`,
                cwd: io.cwd,
                reason: 'Run a command',
                proposedExecpolicyAmendment: [command.split(' ')[0]],
                availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: [command.split(' ')[0]] } }, 'cancel']
            });
            return;
        }
        if (text.startsWith('edit:')) {
            const path = text.slice(5).trim();
            const entry = item('fileChange', { changes: [{ path, kind: { type: 'add' }, diff: `+++ ${path}\n+hello\n` }], status: 'inProgress' });
            started(entry);
            askApproval('fileChange', entry, { reason: 'Write outside the sandbox' });
            return;
        }
        if (text.startsWith('ask:')) {
            const question = text.slice(4).trim();
            pendingQuestion = { rpcId: serverRequestId, questionId: 'color' };
            out({
                method: 'item/tool/requestUserInput',
                id: serverRequestId++,
                params: {
                    threadId,
                    turnId,
                    itemId: 'tool-q',
                    isBlocking: true,
                    questions: [
                        {
                            id: 'color',
                            header: 'Choice',
                            question,
                            isOther: false,
                            isSecret: false,
                            options: [
                                { label: 'Red', description: 'Warm' },
                                { label: 'Blue', description: 'Cool' }
                            ]
                        }
                    ]
                }
            });
            return;
        }
        if (text.startsWith('async:')) {
            const question = text.slice(6).trim();
            pendingSteer = true;
            const entry = item('agentMessage', {
                text: `${question}\n- Red\n- Blue`,
                phase: 'final_answer',
                memoryCitation: null,
                delivery: 'async',
                questions: [{ title: question, options: ['Red', 'Blue'] }]
            });
            started(entry);
            completed(entry);
            return;
        }
        agentMessage(`echo: ${text}${turnEffort ? ` (${turnEffort})` : ''}`);
        turnCompleted('completed');
    };

    const handleApprovalResponse = (approval: PendingApproval, result: Frame): void => {
        pendingApproval = null;
        notify('serverRequest/resolved', { threadId, requestId: approval.rpcId });
        const decision = result.decision;
        const accepted = decision === 'accept' || decision === 'acceptForSession' || (typeof decision === 'object' && decision !== null);
        const always = decision === 'acceptForSession' || (typeof decision === 'object' && decision !== null);
        if (approval.kind === 'command') {
            const command = String(approval.entry.command).replace('/bin/zsh -lc ', '');
            completed({
                ...approval.entry,
                status: accepted ? 'completed' : 'declined',
                aggregatedOutput: accepted ? `ran: ${command}\n` : null,
                exitCode: accepted ? 0 : null
            });
        } else {
            completed({ ...approval.entry, status: accepted ? 'completed' : 'declined' });
        }
        agentMessage(accepted ? (always ? 'done, remembered' : 'done') : 'denied');
        turnCompleted('completed');
    };

    const handleQuestionResponse = (question: { questionId: string }, result: Frame): void => {
        pendingQuestion = null;
        const answers = result.answers as Record<string, { answers?: string[] }> | undefined;
        agentMessage(`you chose ${answers?.[question.questionId]?.answers?.[0] ?? 'no answer'}`);
        turnCompleted('completed');
    };

    const handleRequest = (id: unknown, method: string, params: Frame): void => {
        switch (method) {
            case 'initialize':
                out({ id, result: { userAgent: 'fake-codex/0.0.0', codexHome: io.cwd, platformFamily: 'unix', platformOs: 'test' } });
                return;
            case 'thread/start':
            case 'thread/resume': {
                const resumed = method === 'thread/resume' ? String(params.threadId) : null;
                if (resumed === 'gone') {
                    out({ id, error: { code: -32600, message: 'no thread gone' } });
                    return;
                }
                threadId = resumed ?? `fake-${Math.random().toString(36).slice(2, 8)}`;
                threadModel = typeof params.model === 'string' ? params.model : 'fake-model';
                threadSandbox = typeof params.sandbox === 'string' ? params.sandbox : '';
                threadApproval = typeof params.approvalPolicy === 'string' ? params.approvalPolicy : '';
                threadName = threadId.startsWith('named-') ? 'Named before' : null;
                const thread = { id: threadId, model: threadModel, cwd: params.cwd, turns: [], name: threadName };
                out({
                    id,
                    result: {
                        thread,
                        model: `${threadModel} ${threadApproval} ${threadSandbox}`,
                        modelProvider: 'fake',
                        cwd: params.cwd,
                        approvalPolicy: threadApproval,
                        sandbox: { type: threadSandbox }
                    }
                });
                notify('thread/started', { thread });
                return;
            }
            case 'thread/name/set':
                threadName = String(params.name);
                out({ id, result: {} });
                notify('thread/name/updated', { threadId, threadName });
                return;
            case 'turn/start':
                out({ id, result: { turn: { id: `turn-${itemCounter + 1}`, items: [], status: 'inProgress', error: null } } });
                handleTurnStart(params);
                return;
            case 'turn/steer': {
                // The real app-server refuses a steer that does not name the turn it is meant for.
                if (params.expectedTurnId !== turnId) {
                    out({ id, error: { code: -32602, message: 'Invalid request: missing field `expectedTurnId`' } });
                    // The real turn would go on polling; ending it here makes a test fail on its
                    // assertion rather than on a timeout.
                    pendingSteer = false;
                    turnCompleted('failed');
                    return;
                }
                out({ id, result: { turnId } });
                if (pendingSteer) {
                    pendingSteer = false;
                    const input = Array.isArray(params.input) ? (params.input[0] as { text?: string } | undefined) : undefined;
                    agentMessage(`you chose ${input?.text ?? 'no answer'}`);
                    turnCompleted('completed');
                }
                return;
            }
            case 'turn/interrupt':
                out({ id, result: {} });
                if (slow) {
                    slow = false;
                    turnCompleted('interrupted');
                }
                return;
            case 'thread/compact/start':
                out({ id, result: {} });
                turnStarted();
                started(item('contextCompaction', {}));
                completed(item('contextCompaction', {}));
                turnCompleted('completed');
                return;
            default:
                out({ id, error: { code: -32601, message: `unknown method ${method}` } });
        }
    };

    return {
        onLine: (line) => {
            const frame = JSON.parse(line) as Frame;
            const params = (frame.params ?? {}) as Frame;
            if (typeof frame.method === 'string' && frame.id !== undefined) {
                handleRequest(frame.id, frame.method, params);
                return;
            }
            if (frame.id === undefined || frame.result === undefined) {
                return;
            }
            const result = frame.result as Frame;
            const approval = pendingApproval;
            const question = pendingQuestion;
            if (approval && approval.rpcId === frame.id) {
                handleApprovalResponse(approval, result);
            } else if (question && question.rpcId === frame.id) {
                handleQuestionResponse(question, result);
            }
        }
    };
};

if (import.meta.main) {
    await runOverStdio(fakeCodex);
}
