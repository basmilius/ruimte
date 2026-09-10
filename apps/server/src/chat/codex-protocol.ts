import type { ChatFileChange, ChatQuestion } from '@ruimte/contracts';
import type { ApprovalDecision, BackendEvent } from './backend.ts';
import type { CodexFrame } from './codex-transport.ts';

type CodexRpcId = number | string;

/* How an answer reaches the app-server: as the reply to its request, or as a steer into the turn. */
type CodexAnswer = { kind: 'respond'; rpcId: CodexRpcId; result: unknown } | { kind: 'steer'; text: string };

type Frame = Record<string, unknown>;

const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// Codex wraps every command in a login shell; the person wants to read the command, not the wrapper.
const SHELL_WRAPPER = /^(?:\/bin\/|\/usr\/bin\/)?(?:zsh|bash|sh) -lc (.*)$/s;

export const unwrapCommand = (command: string): string => {
    const match = SHELL_WRAPPER.exec(command);
    if (!match) {
        return command;
    }
    const inner = match[1]!;
    const quoted = /^(["'])([\s\S]*)\1$/.exec(inner);
    return quoted ? quoted[2]! : inner;
};

const textOf = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .map((block) => (isRecord(block) ? (str(block.text) ?? null) : null))
        .filter((text): text is string => text !== null)
        .join('\n');
};

/* What became of every agent a collab call touched, one line each; empty while the call still runs. */
const collabAgentOutput = (states: unknown): string => {
    if (!isRecord(states)) {
        return '';
    }
    return Object.entries(states)
        .map(([thread, state]) => {
            const status = isRecord(state) ? (str(state.status) ?? 'unknown') : 'unknown';
            const message = isRecord(state) ? str(state.message) : null;
            return message ? `${thread}: ${status}, ${message}` : `${thread}: ${status}`;
        })
        .join('\n');
};

/* A blocking `request_user_input` question, as far as the person needs to see it. */
const parseBlockingQuestions = (questions: unknown): ChatQuestion[] => {
    if (!Array.isArray(questions)) {
        return [];
    }
    return questions.filter(isRecord).map((question, index) => ({
        id: str(question.id) ?? String(index),
        header: str(question.header) ?? '',
        question: str(question.question) ?? '',
        choices: Array.isArray(question.options)
            ? question.options.filter(isRecord).map((option) => ({ label: str(option.label) ?? '', description: str(option.description) ?? '' }))
            : [],
        multiSelect: false
    }));
};

/* The questions an agent message carries when Codex asks without blocking the turn. */
const parseAsyncQuestions = (questions: unknown): ChatQuestion[] => {
    if (!Array.isArray(questions)) {
        return [];
    }
    return questions.filter(isRecord).map((question, index) => ({
        id: String(index),
        header: '',
        question: str(question.title) ?? '',
        choices: Array.isArray(question.options)
            ? question.options.filter((option): option is string => typeof option === 'string').map((option) => ({ label: option, description: '' }))
            : [],
        multiSelect: false
    }));
};

const toLines = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string' && line.trim() !== '') : [];

const CHANGE_KINDS = new Set<ChatFileChange['kind']>(['add', 'update', 'delete']);

/* The files a `fileChange` item touches, with the unified diff Codex reports per file. */
const parseChanges = (value: unknown): ChatFileChange[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord).map((change) => {
        const kind = isRecord(change.kind) ? str(change.kind.type) : str(change.kind);
        return {
            path: str(change.path) ?? '',
            kind: kind !== null && CHANGE_KINDS.has(kind as ChatFileChange['kind']) ? (kind as ChatFileChange['kind']) : 'update',
            diff: str(change.diff) ?? ''
        };
    });
};

// Partial command output arrives as text or as the raw bytes of it, depending on the build.
const outputChunk = (params: Frame): string | null => {
    const text = str(params.delta) ?? str(params.chunk);
    if (text !== null) {
        return text;
    }
    const bytes = params.chunk ?? params.delta;
    if (!Array.isArray(bytes)) {
        return null;
    }
    return new TextDecoder().decode(Uint8Array.from(bytes.filter((byte): byte is number => typeof byte === 'number')));
};

type Pending =
    | { type: 'approval'; rpcId: CodexRpcId; kind: 'command' | 'fileChange'; amendment: string[] | null; decisions: string[] }
    | { type: 'question'; rpcId: CodexRpcId | null; questionIds: string[] };

/*
 * The `codex app-server` protocol, in and out: notifications and the server's own requests become
 * backend events, an answer becomes the reply or the steer that settles one. One instance belongs
 * to one process; request ids start at 0 in every process, so they carry the generation.
 */
export class CodexProtocol {
    private readonly generation: number;
    private readonly pending = new Map<string, Pending>();
    // The input the thread shows for an item, so an approval about it can repeat what it is for.
    private readonly toolInputs = new Map<string, { input: unknown; changes: ChatFileChange[] }>();
    private codexTurnId: string | null = null;

    constructor(generation: number) {
        this.generation = generation;
    }

    /* The turn Codex is running, what `turn/interrupt` needs. */
    get turnId(): string | null {
        return this.codexTurnId;
    }

    /* The result of `thread/start` or `thread/resume`: the thread id is what a terminal resumes. */
    threadReady(result: unknown): BackendEvent[] {
        const thread = isRecord(result) && isRecord(result.thread) ? result.thread : {};
        return [
            {
                type: 'session',
                agentSessionId: str(thread.id),
                model: (isRecord(result) ? str(result.model) : null) ?? str(thread.model)
            }
        ];
    }

    handle(frame: CodexFrame): BackendEvent[] {
        const events: BackendEvent[] = [];
        if (typeof frame.method !== 'string') {
            return events;
        }
        const params = isRecord(frame.params) ? frame.params : {};
        if (frame.id !== undefined) {
            this.handleServerRequest(frame.method, frame.id as CodexRpcId, params, events);
            return events;
        }
        switch (frame.method) {
            case 'thread/started':
                events.push({
                    type: 'session',
                    agentSessionId: isRecord(params.thread) ? str(params.thread.id) : null,
                    model: null
                });
                break;
            case 'turn/started':
                this.codexTurnId = isRecord(params.turn) ? str(params.turn.id) : null;
                break;
            case 'turn/completed':
                this.handleTurnCompleted(params, events);
                break;
            case 'item/started':
            case 'item/completed':
                this.handleItem(params, frame.method === 'item/completed', events);
                break;
            case 'item/agentMessage/delta': {
                const ref = str(params.itemId);
                const text = str(params.delta);
                if (ref && text) {
                    events.push({ type: 'text.delta', ref, text });
                }
                break;
            }
            case 'item/reasoning/summaryTextDelta':
            case 'item/reasoning/textDelta': {
                const ref = str(params.itemId);
                const text = str(params.delta);
                if (ref && text) {
                    events.push({ type: 'thinking.delta', ref, text });
                }
                break;
            }
            case 'item/reasoning/summaryPartAdded': {
                // A new part of the same summary; without a break the parts run into each other.
                const ref = str(params.itemId);
                if (ref && num(params.summaryIndex) > 0) {
                    events.push({ type: 'thinking.delta', ref, text: '\n\n' });
                }
                break;
            }
            case 'item/commandExecution/outputDelta': {
                const ref = str(params.itemId);
                const text = outputChunk(params);
                if (ref && text) {
                    events.push({ type: 'tool.output', ref, text });
                }
                break;
            }
            case 'thread/tokenUsage/updated': {
                const usage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
                const last = isRecord(usage.last) ? usage.last : {};
                const contextWindow = num(usage.modelContextWindow);
                events.push({
                    type: 'usage',
                    contextTokens: num(last.totalTokens),
                    ...(contextWindow > 0 ? { contextWindow } : {})
                });
                break;
            }
            case 'serverRequest/resolved': {
                const rpcId = params.requestId;
                if (typeof rpcId === 'number' || typeof rpcId === 'string') {
                    const requestId = this.requestId(rpcId);
                    this.pending.delete(requestId);
                    events.push({ type: 'request.withdrawn', requestId });
                }
                break;
            }
            case 'error': {
                const error = isRecord(params.error) ? params.error : {};
                events.push({ type: 'note', level: params.willRetry === true ? 'warning' : 'error', text: str(error.message) ?? 'Codex reported an error' });
                break;
            }
            case 'model/rerouted': {
                const model = str(params.toModel);
                if (model) {
                    events.push({ type: 'model', model });
                }
                break;
            }
            default:
                break;
        }
        return events;
    }

    /* The reply that settles an approval, or null when nothing waits under that id. */
    approvalDecision(requestId: string, decision: ApprovalDecision): { rpcId: CodexRpcId; result: unknown } | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'approval') {
            return null;
        }
        this.pending.delete(requestId);
        return { rpcId: pending.rpcId, result: { decision: codexDecision(decision, pending) } };
    }

    /* What answers a question: the reply to a blocking one, or the text that steers a running turn. */
    questionAnswer(requestId: string, answers: Record<string, string>): CodexAnswer | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'question') {
            return null;
        }
        this.pending.delete(requestId);
        const given = pending.questionIds.map((id) => answers[id]).filter((answer): answer is string => answer !== undefined);
        if (pending.rpcId === null) {
            // An async question is answered like a message from the person, into the running turn.
            return { kind: 'steer', text: given.join('\n') };
        }
        const byId: Record<string, { answers: string[] }> = {};
        for (const id of pending.questionIds) {
            const answer = answers[id];
            if (answer !== undefined) {
                byId[id] = { answers: [answer] };
            }
        }
        return { kind: 'respond', rpcId: pending.rpcId, result: { answers: byId } };
    }

    /* Drops an asynchronous question the person walked away from; a blocking one has to be answered. */
    dismissQuestion(requestId: string): boolean {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'question' || pending.rpcId !== null) {
            return false;
        }
        this.pending.delete(requestId);
        return true;
    }

    forgetPending(): void {
        this.pending.clear();
    }

    private requestId(rpcId: CodexRpcId): string {
        return `${this.generation}-${rpcId}`;
    }

    private handleServerRequest(method: string, rpcId: CodexRpcId, params: Frame, events: BackendEvent[]): void {
        const requestId = this.requestId(rpcId);
        if (method === 'item/tool/requestUserInput') {
            const questions = parseBlockingQuestions(params.questions);
            if (questions.length === 0) {
                return;
            }
            this.pending.set(requestId, { type: 'question', rpcId, questionIds: questions.map((question) => question.id) });
            events.push({ type: 'question.requested', requestId, questions });
            return;
        }
        const kind = method === 'item/commandExecution/requestApproval' ? 'command' : method === 'item/fileChange/requestApproval' ? 'fileChange' : null;
        if (!kind) {
            return;
        }
        const itemId = str(params.itemId);
        const known = itemId ? this.toolInputs.get(itemId) : undefined;
        const decisions = Array.isArray(params.availableDecisions)
            ? params.availableDecisions.map((decision) =>
                  typeof decision === 'string' ? decision : (Object.keys(isRecord(decision) ? decision : {})[0] ?? '')
              )
            : [];
        const amendment = Array.isArray(params.proposedExecpolicyAmendment)
            ? params.proposedExecpolicyAmendment.filter((word): word is string => typeof word === 'string')
            : null;
        // The person must see what they are approving, so a file change repeats its diffs here.
        const input =
            kind === 'command'
                ? { command: unwrapCommand(str(params.command) ?? ''), cwd: str(params.cwd) ?? undefined }
                : { ...(isRecord(known?.input) ? known.input : { itemId }), changes: known?.changes ?? [] };
        this.pending.set(requestId, { type: 'approval', rpcId, kind, amendment: amendment && amendment.length > 0 ? amendment : null, decisions });
        events.push({
            type: 'approval.requested',
            requestId,
            ref: itemId,
            toolName: kind === 'command' ? 'Bash' : 'ApplyPatch',
            input,
            description: str(params.reason),
            canAllowAlways: (amendment !== null && amendment.length > 0) || decisions.includes('acceptForSession')
        });
    }

    private handleItem(params: Frame, completed: boolean, events: BackendEvent[]): void {
        const item = isRecord(params.item) ? params.item : null;
        const ref = item ? str(item.id) : null;
        if (!item || !ref) {
            return;
        }
        switch (item.type) {
            case 'agentMessage': {
                const questions = parseAsyncQuestions(item.questions);
                if (questions.length > 0) {
                    // Codex keeps polling for an answer to this one; the id it carries is the item's own.
                    if (!completed || this.pending.has(ref)) {
                        return;
                    }
                    this.pending.set(ref, { type: 'question', rpcId: null, questionIds: questions.map((question) => question.id) });
                    events.push({ type: 'question.requested', requestId: ref, questions, async: true });
                    return;
                }
                this.text(ref, str(item.text) ?? '', completed, events);
                return;
            }
            case 'plan':
                this.text(`plan-${ref}`, str(item.text) ?? '', completed, events);
                return;
            case 'reasoning': {
                // The deltas already streamed this; the completed item is what a resumed thread replays.
                const lines = [...toLines(item.summary), ...toLines(item.content)];
                if (completed && lines.length > 0) {
                    events.push({ type: 'thinking.done', ref, text: lines.join('\n\n') });
                }
                return;
            }
            case 'commandExecution':
                this.tool(
                    ref,
                    'Bash',
                    { command: unwrapCommand(str(item.command) ?? ''), cwd: str(item.cwd) ?? undefined },
                    completed,
                    str(item.aggregatedOutput) ?? '',
                    str(item.status) === 'completed',
                    events
                );
                return;
            case 'fileChange': {
                const changes = parseChanges(item.changes);
                this.tool(
                    ref,
                    'ApplyPatch',
                    { summary: changes.map((change) => change.path).join(', ') },
                    completed,
                    changes.map((change) => change.diff).join('\n'),
                    str(item.status) === 'completed',
                    events,
                    changes
                );
                return;
            }
            case 'mcpToolCall': {
                const result = isRecord(item.result) ? textOf(item.result.content) : '';
                const error = isRecord(item.error) ? (str(item.error.message) ?? '') : '';
                this.tool(
                    ref,
                    `${str(item.server) ?? 'mcp'}/${str(item.tool) ?? 'tool'}`,
                    item.arguments ?? {},
                    completed,
                    error || result,
                    str(item.status) === 'completed',
                    events
                );
                return;
            }
            case 'dynamicToolCall':
                this.tool(ref, str(item.tool) ?? 'tool', item.arguments ?? {}, completed, textOf(item.contentItems), item.success !== false, events);
                return;
            case 'webSearch': {
                const action = isRecord(item.action) ? item.action : {};
                this.tool(ref, 'WebSearch', { query: str(item.query) ?? str(action.query) ?? '' }, completed, '', true, events);
                return;
            }
            case 'collabAgentToolCall': {
                // Codex's own multi-agent calls: spawning one is a delegation, the rest are what they are.
                const tool = str(item.tool) ?? 'collabAgent';
                const input = { tool, prompt: str(item.prompt) ?? undefined, model: str(item.model) ?? undefined, threads: item.receiverThreadIds ?? [] };
                if (tool === 'spawnAgent') {
                    this.spawnedAgent(ref, item, input, events);
                    return;
                }
                this.tool(ref, tool, input, completed, collabAgentOutput(item.agentsStates), str(item.status) === 'completed', events);
                return;
            }
            case 'contextCompaction':
                if (completed) {
                    events.push({ type: 'compaction', preTokens: null });
                }
                return;
            default:
                return;
        }
    }

    private handleTurnCompleted(params: Frame, events: BackendEvent[]): void {
        const turn = isRecord(params.turn) ? params.turn : {};
        const status = str(turn.status);
        const error = isRecord(turn.error) ? str(turn.error.message) : null;
        this.codexTurnId = null;
        this.pending.clear();
        events.push({
            type: 'turn.done',
            state: status === 'interrupted' ? 'aborted' : status === 'failed' ? 'error' : 'done',
            // Codex reports no cost; the turn keeps a zero so the fold label can still say how long it took.
            costUsd: 0,
            ...(status === 'failed' ? { error: error ?? 'The turn failed' } : {})
        });
    }

    private text(ref: string, text: string, completed: boolean, events: BackendEvent[]): void {
        events.push(completed ? { type: 'text.done', ref, text } : { type: 'text.delta', ref, text });
    }

    /*
     * An agent Codex spawned. It works in a thread of its own, so this row never grows children or a
     * report: what there is to say about it is the state Codex keeps per agent it touched.
     */
    private spawnedAgent(ref: string, item: Frame, input: unknown, events: BackendEvent[]): void {
        const status = str(item.status);
        const summary = collabAgentOutput(item.agentsStates);
        events.push({ type: 'tool.started', ref, name: 'Agent', input, parentRef: null });
        events.push({
            type: 'task.started',
            ref,
            description: (str(item.prompt) ?? '').split('\n')[0] ?? '',
            subagentType: null,
            prompt: str(item.prompt),
            // A spawned agent never blocks the turn that spawned it.
            background: true
        });
        if (status === 'inProgress' || status === null) {
            events.push({ type: 'task.progress', ref, summary: summary || null, lastTool: null, usage: null });
            return;
        }
        events.push({ type: 'task.done', ref, summary: summary || null, ok: status === 'completed' });
    }

    private tool(
        ref: string,
        name: string,
        input: unknown,
        completed: boolean,
        output: string,
        succeeded: boolean,
        events: BackendEvent[],
        changes?: ChatFileChange[]
    ): void {
        this.toolInputs.set(ref, { input, changes: changes ?? [] });
        events.push({ type: 'tool.started', ref, name, input, parentRef: null, ...(changes && changes.length > 0 ? { changes } : {}) });
        if (completed) {
            events.push({ type: 'tool.done', ref, output, state: succeeded ? 'done' : 'error', ...(changes && changes.length > 0 ? { changes } : {}) });
        }
    }
}

/* The decision the app-server takes for one of ours; "always" becomes its own policy amendment when it offered one. */
const codexDecision = (decision: ApprovalDecision, pending: Extract<Pending, { type: 'approval' }>): unknown => {
    if (decision === 'deny') {
        return 'decline';
    }
    if (decision === 'allow') {
        return 'accept';
    }
    if (pending.amendment) {
        return { acceptWithExecpolicyAmendment: { execpolicy_amendment: pending.amendment } };
    }
    return pending.kind === 'fileChange' || pending.decisions.includes('acceptForSession') ? 'acceptForSession' : 'accept';
};
