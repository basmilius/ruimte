/*
 * Network-free `codex app-server` fake. Prompt commands exercise approvals, edits, questions,
 * interrupts, failures, names, subagents, pagination and forks through the real JSON-RPC shapes.
 */
import { CONTEXT_LEAD } from '../context/context-note.ts';
import { runOverStdio, type FakeCli } from './fake-cli.ts';

type Frame = Record<string, unknown>;

type PendingApproval = { rpcId: number; entry: Frame; kind: 'command' | 'fileChange' };

// How many steps a spawned agent takes: more than a thread row keeps, so only its own thread has them all.
export const FAKE_CHILD_STEPS = 250;

// The threads of spawned agents, outside any one process: the real ones are on disk, so a process that never ran them reads them too.
const childThreads = new Map<string, Frame[]>();

// The turn ids per thread, outside any one process for the same reason.
const threadTurns = new Map<string, string[]>();

// The developer instructions per thread, kept from its start the way Codex keeps them in the rollout.
const threadInstructions = new Map<string, string | null>();

// Every `thread/fork` a fake was asked, oldest first, so a test can see what the daemon forked at.
export const fakeCodexForks: Frame[] = [];

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
    let pasted: string | null = null;

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
                // Codex reports the window of the model the thread runs on, which spark makes smaller.
                modelContextWindow: threadModel.includes('spark') ? 121600 : 258400
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
        turnId = `turn-${nonce}-${++itemCounter}`;
        threadTurns.set(threadId, [...(threadTurns.get(threadId) ?? []), turnId]);
        notify('thread/status/changed', { threadId, status: { type: 'active', activeFlags: [] } });
        notify('turn/started', { threadId, turn: { id: turnId, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null } });
    };

    const turnCompleted = (status: 'completed' | 'interrupted' | 'failed', error: string | null = null, codexErrorInfo: string | null = null): void => {
        usage();
        notify('thread/status/changed', { threadId, status: { type: 'idle' } });
        notify('turn/completed', {
            threadId,
            turn: {
                id: turnId,
                items: [],
                itemsView: 'summary',
                status,
                error: error ? { message: error, codexErrorInfo, additionalDetails: null } : null
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
        // A resumed process puts the sentence about links in front of its first prompt; `pasted?` asks for it back.
        const gap = raw.indexOf('\n\n');
        const noted = raw.startsWith(CONTEXT_LEAD) && gap !== -1;
        if (noted) {
            pasted = raw.slice(0, gap);
        }
        const text = noted ? raw.slice(gap + 2) : raw;
        if (text === 'name?') {
            turnStarted();
            agentMessage(threadName ?? 'unnamed');
            turnCompleted('completed');
            return;
        }
        if (text === 'note?' || text === 'pasted?') {
            turnStarted();
            agentMessage((text === 'note?' ? threadInstructions.get(threadId) : pasted) ?? 'nothing');
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
        if (text === 'crash loudly') {
            io.err('Error: the fake lost its thread\n');
            io.exit(1);
            return;
        }
        if (text === 'fail') {
            turnCompleted('failed', 'The model is overloaded');
            return;
        }
        // Lines of their own, so a task brief around them still fails the way Codex 0.156.1 does.
        const lines = text.split('\n');
        if (lines.includes('overloaded')) {
            turnCompleted('failed', 'Selected model is at capacity. Please try a different model.', 'serverOverloaded');
            return;
        }
        const limit = lines.find((line) => line.startsWith('limit:'));
        if (limit !== undefined) {
            notify('account/rateLimits/updated', {
                rateLimits: {
                    limitId: 'codex',
                    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Number(limit.slice(6)) },
                    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: Number(limit.slice(6)) + 86_400 }
                }
            });
            turnCompleted('failed', "You've hit your usage limit.", 'usageLimitExceeded');
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
        const finish = text.startsWith('spawn and finish:');
        if (finish || text.startsWith('spawn:')) {
            const prompt = text.slice(text.indexOf(':') + 1).trim();
            const childId = `child-${nonce}-${++itemCounter}`;
            const steps: Frame[] = [{ type: 'userMessage', id: `${childId}-prompt`, content: [{ type: 'text', text: prompt, text_elements: [] }] }];
            for (let step = 1; step <= FAKE_CHILD_STEPS; step++) {
                steps.push({
                    type: 'commandExecution',
                    id: `${childId}-step-${step}`,
                    command: `/bin/zsh -lc 'echo ${step}'`,
                    cwd: io.cwd,
                    status: 'completed',
                    aggregatedOutput: `${step}\n`,
                    exitCode: 0
                });
            }
            childThreads.set(childId, steps);
            const spawn = item('collabAgentToolCall', {
                tool: 'spawnAgent',
                prompt,
                model: 'fake-model',
                senderThreadId: threadId,
                receiverThreadIds: [],
                agentsStates: {},
                status: 'inProgress'
            });
            started(spawn);
            const running = { ...spawn, receiverThreadIds: [childId], agentsStates: { [childId]: { status: 'running', message: null } } };
            if (!finish) {
                completed(running);
                agentMessage('spawned');
                turnCompleted('completed');
                return;
            }
            completed({ ...running, status: 'completed', agentsStates: { [childId]: { status: 'completed', message: 'the docs are read' } } });
            agentMessage('spawned');
            const spawnedIn = turnId;
            turnCompleted('completed');
            // A snapshot of the call from while its agent still ran, delivered after the agent finished.
            io.later(() => notify('item/completed', { item: running, threadId, turnId: spawnedIn, completedAtMs: Date.now() }));
            return;
        }
        /*
         * A spawn the way Codex 0.156.1 reports it: no spawnAgent call, a `subAgentActivity` that started under
         * the call id, the agent's own thread streaming over the same connection, and a `completed` activity
         * with an id of its own once the agent is done, here after the parent's turn ended.
         */
        if (text.startsWith('spawn agent:')) {
            const prompt = text.slice(text.indexOf(':') + 1).trim();
            const childId = `child-${nonce}-${++itemCounter}`;
            const childTurn = `turn-${nonce}-${++itemCounter}`;
            childThreads.set(childId, [{ type: 'userMessage', id: `${childId}-prompt`, content: [{ type: 'text', text: prompt, text_elements: [] }] }]);
            const activity = (id: string, kind: string): void => {
                const entry = { type: 'subAgentActivity', id, kind, agentThreadId: childId, agentPath: '/root/survey' };
                started(entry);
                completed(entry);
            };
            const inChild = (method: string, params: Frame): void => {
                notify(method, { threadId: childId, ...params });
            };
            activity(`call-spawn-${nonce}-${++itemCounter}`, 'started');
            inChild('thread/status/changed', { status: { type: 'active', activeFlags: [] } });
            inChild('turn/started', { turn: { id: childTurn, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null } });
            const step = { type: 'commandExecution', id: `${childId}-step`, command: "/bin/zsh -lc 'echo PONG'", cwd: io.cwd, status: 'completed' };
            inChild('item/started', { turnId: childTurn, item: { ...step, status: 'inProgress' } });
            inChild('item/completed', { turnId: childTurn, item: { ...step, aggregatedOutput: 'PONG\n', exitCode: 0 } });
            inChild('item/completed', { turnId: childTurn, item: { type: 'agentMessage', id: `${childId}-answer`, text: 'PONG', phase: 'final_answer' } });
            inChild('turn/completed', { turn: { id: childTurn, items: [], itemsView: 'summary', status: 'completed', error: null } });
            agentMessage('spawned');
            turnCompleted('completed');
            io.later(() => activity(`subagent-completed-${childTurn}`, 'completed'));
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
            case 'model/list':
                out({
                    id,
                    result: { data: [{ model: threadModel, inputModalities: threadModel.includes('spark') ? ['text'] : ['text', 'image'] }], nextCursor: null }
                });
                return;
            case 'thread/start':
            case 'thread/resume': {
                const resumed = method === 'thread/resume' ? String(params.threadId) : null;
                if (resumed === 'gone') {
                    out({ id, error: { code: -32600, message: 'no thread gone' } });
                    return;
                }
                threadId = resumed ?? `fake-${Math.random().toString(36).slice(2, 8)}`;
                // Codex 0.154 ignores developer instructions on a resume; only a start sets them.
                if (resumed === null) {
                    threadInstructions.set(threadId, typeof params.developerInstructions === 'string' ? params.developerInstructions : null);
                }
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
            case 'thread/fork': {
                const source = String(params.threadId);
                const turns = threadTurns.get(source) ?? [];
                const last = typeof params.lastTurnId === 'string' ? turns.indexOf(params.lastTurnId) : turns.length - 1;
                if (!threadTurns.has(source) || (typeof params.lastTurnId === 'string' && last < 0)) {
                    out({ id, error: { code: -32600, message: `no rollout found for thread id ${source}` } });
                    return;
                }
                fakeCodexForks.push(params);
                const forked = `fork-${Math.random().toString(36).slice(2, 8)}`;
                threadTurns.set(forked, turns.slice(0, last + 1));
                threadInstructions.set(forked, threadInstructions.get(source) ?? null);
                out({ id, result: { thread: { id: forked, forkedFromId: source, cwd: params.cwd, turns: [] }, model: params.model ?? 'fake-model' } });
                return;
            }
            case 'thread/turns/list': {
                const turns = threadTurns.get(String(params.threadId)) ?? [];
                out({ id, result: { data: turns.map((turn) => ({ id: turn, items: [], status: 'completed', error: null })), nextCursor: null } });
                return;
            }
            case 'thread/items/list': {
                const steps = childThreads.get(String(params.threadId));
                if (!steps) {
                    out({ id, error: { code: -32600, message: `no rollout found for thread id ${String(params.threadId)}` } });
                    return;
                }
                // The cursor is where the next page starts, counted from the end the list is sorted from.
                const ordered = params.sortDirection === 'asc' ? steps : [...steps].reverse();
                const start = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
                const limit = typeof params.limit === 'number' ? params.limit : 50;
                const page = ordered.slice(start, start + limit);
                const next = start + limit < ordered.length ? String(start + limit) : null;
                out({ id, result: { data: page.map((entry) => ({ item: entry, turnId: 'child-turn' })), nextCursor: next, backwardsCursor: null } });
                return;
            }
            case 'thread/name/set':
                threadName = String(params.name);
                out({ id, result: {} });
                notify('thread/name/updated', { threadId, threadName });
                return;
            case 'turn/start':
                out({ id, result: { turn: { id: `turn-${nonce}-${itemCounter + 1}`, items: [], status: 'inProgress', error: null } } });
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
