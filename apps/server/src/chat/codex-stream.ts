import type { ChatEvent, ChatItem, ChatQuestion, ChatToolItem } from '@ruimte/contracts';
import type { ChatThread } from './thread.ts';

export type CodexRpcId = number | string;

/*
 * What the app-server waits for. An approval and a blocking question are JSON-RPC requests the
 * session answers by id; an async question is an agent message with options that Codex keeps
 * polling for, answered by steering the turn with text (`rpcId` is null then).
 */
export type CodexAction =
    | { type: 'approval'; requestId: string; rpcId: CodexRpcId; kind: 'command' | 'fileChange'; amendment: string[] | null; decisions: string[] }
    | { type: 'question'; requestId: string; rpcId: CodexRpcId | null };

export interface CodexReducerOutput {
    events: ChatEvent[];
    actions: CodexAction[];
}

type Frame = Record<string, unknown>;

const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const empty = (): CodexReducerOutput => ({ events: [], actions: [] });

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

/* A blocking `request_user_input` question, as far as the person needs to see it. */
export const parseBlockingQuestions = (questions: unknown): ChatQuestion[] => {
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
export const parseAsyncQuestions = (questions: unknown): ChatQuestion[] => {
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

/*
 * Folds app-server notifications and server requests into thread events. Codex item ids are
 * unique on their own, so an item is keyed by them; approval ids are JSON-RPC ids that start
 * over with every process, so they carry the process generation.
 */
export class CodexStreamReducer {
    private readonly thread: ChatThread;
    private readonly now: () => number;
    private generation = 0;
    private codexTurnId: string | null = null;

    constructor(thread: ChatThread, now: () => number = Date.now) {
        this.thread = thread;
        this.now = now;
    }

    /* The turn Codex is running, what `turn/interrupt` needs. */
    get turnId(): string | null {
        return this.codexTurnId;
    }

    nextProcess(): void {
        this.generation += 1;
        this.codexTurnId = null;
    }

    /* The result of `thread/start` or `thread/resume`: the thread id is what a terminal resumes. */
    threadReady(result: unknown): CodexReducerOutput {
        const out = empty();
        const thread = isRecord(result) && isRecord(result.thread) ? result.thread : {};
        out.events.push(
            this.thread.patchInfo({
                agentSessionId: str(thread.id) ?? this.thread.info.agentSessionId,
                model: (isRecord(result) ? str(result.model) : null) ?? str(thread.model) ?? this.thread.info.model,
                running: true
            })
        );
        return out;
    }

    handle(frame: unknown): CodexReducerOutput {
        const out = empty();
        if (!isRecord(frame) || typeof frame.method !== 'string') {
            return out;
        }
        const params = isRecord(frame.params) ? frame.params : {};
        if (frame.id !== undefined) {
            this.handleServerRequest(frame.method, frame.id as CodexRpcId, params, out);
            return out;
        }
        switch (frame.method) {
            case 'thread/started':
                out.events.push(
                    this.thread.patchInfo({ agentSessionId: (isRecord(params.thread) ? str(params.thread.id) : null) ?? this.thread.info.agentSessionId })
                );
                break;
            case 'turn/started':
                this.codexTurnId = isRecord(params.turn) ? str(params.turn.id) : null;
                break;
            case 'turn/completed':
                this.handleTurnCompleted(params, out);
                break;
            case 'item/started':
            case 'item/completed':
                this.handleItem(params, frame.method === 'item/completed', out);
                break;
            case 'item/agentMessage/delta':
                this.handleDelta(params, out);
                break;
            case 'thread/tokenUsage/updated':
                this.handleUsage(params, out);
                break;
            case 'serverRequest/resolved':
                this.cancelRequest(params.requestId, out);
                break;
            case 'error':
                this.handleError(params, out);
                break;
            case 'model/rerouted':
                out.events.push(this.thread.patchInfo({ model: str(params.toModel) ?? this.thread.info.model }));
                break;
            default:
                break;
        }
        return out;
    }

    /* A request to the app-server failed; the turn cannot go on. */
    fail(message: string): CodexReducerOutput {
        const out = empty();
        out.events.push(this.note('error', message));
        this.settleOpenItems(out);
        this.closeTurn('error', out);
        out.events.push(this.thread.patchInfo({ status: 'error', activeTurnId: null }));
        return out;
    }

    /* The process went away; whatever was open is closed with the reason on the thread. */
    finish(exitCode: number | null): CodexReducerOutput {
        const out = empty();
        this.settleOpenItems(out);
        const busy = this.thread.info.status === 'running' || this.thread.info.status === 'needs-you';
        if (busy || (exitCode !== null && exitCode !== 0)) {
            out.events.push(this.note('error', exitCode === null ? 'Codex stopped' : `Codex exited with code ${exitCode}`));
        }
        this.closeTurn(busy ? 'error' : 'done', out);
        out.events.push(this.thread.patchInfo({ running: false, status: busy ? 'error' : 'idle', activeTurnId: null }));
        this.codexTurnId = null;
        return out;
    }

    private handleServerRequest(method: string, rpcId: CodexRpcId, params: Frame, out: CodexReducerOutput): void {
        const requestId = `${this.generation}-${rpcId}`;
        if (method === 'item/tool/requestUserInput') {
            const questions = parseBlockingQuestions(params.questions);
            if (questions.length === 0) {
                return;
            }
            out.events.push(this.questionItem(requestId, questions));
            out.events.push(this.thread.setStatus('needs-you'));
            out.actions.push({ type: 'question', requestId, rpcId });
            return;
        }
        const kind = method === 'item/commandExecution/requestApproval' ? 'command' : method === 'item/fileChange/requestApproval' ? 'fileChange' : null;
        if (!kind) {
            return;
        }
        const itemId = str(params.itemId);
        const tool = itemId ? this.thread.get(itemId) : undefined;
        const decisions = Array.isArray(params.availableDecisions)
            ? params.availableDecisions.map((decision) =>
                  typeof decision === 'string' ? decision : (Object.keys(isRecord(decision) ? decision : {})[0] ?? '')
              )
            : [];
        const amendment = Array.isArray(params.proposedExecpolicyAmendment)
            ? params.proposedExecpolicyAmendment.filter((word): word is string => typeof word === 'string')
            : null;
        const input =
            kind === 'command'
                ? { command: unwrapCommand(str(params.command) ?? ''), cwd: str(params.cwd) ?? undefined }
                : tool?.kind === 'tool'
                  ? tool.input
                  : { itemId };
        out.events.push(
            this.thread.upsert({
                id: `approval-${requestId}`,
                kind: 'approval',
                createdAt: this.now(),
                turnId: this.thread.info.activeTurnId,
                requestId,
                toolUseId: itemId,
                toolName: kind === 'command' ? 'Bash' : 'ApplyPatch',
                input,
                description: str(params.reason),
                canAllowAlways: (amendment !== null && amendment.length > 0) || decisions.includes('acceptForSession'),
                decision: 'pending'
            })
        );
        out.events.push(this.thread.setStatus('needs-you'));
        out.actions.push({ type: 'approval', requestId, rpcId, kind, amendment: amendment && amendment.length > 0 ? amendment : null, decisions });
    }

    private handleItem(params: Frame, completed: boolean, out: CodexReducerOutput): void {
        const item = isRecord(params.item) ? params.item : null;
        const id = item ? str(item.id) : null;
        if (!item || !id) {
            return;
        }
        switch (item.type) {
            case 'agentMessage': {
                const questions = parseAsyncQuestions(item.questions);
                if (questions.length > 0) {
                    if (!completed || this.thread.get(`question-${id}`)) {
                        return;
                    }
                    out.events.push(this.questionItem(id, questions));
                    out.events.push(this.thread.setStatus('needs-you'));
                    out.actions.push({ type: 'question', requestId: id, rpcId: null });
                    return;
                }
                this.upsertAssistant(id, str(item.text) ?? '', !completed, out);
                return;
            }
            case 'plan':
                this.upsertAssistant(`plan-${id}`, str(item.text) ?? '', !completed, out);
                return;
            case 'commandExecution': {
                const status = str(item.status);
                this.upsertTool(
                    id,
                    'Bash',
                    { command: unwrapCommand(str(item.command) ?? ''), cwd: str(item.cwd) ?? undefined },
                    completed ? (str(item.aggregatedOutput) ?? '') : null,
                    completed ? (status === 'completed' ? 'done' : 'error') : 'running',
                    out
                );
                return;
            }
            case 'fileChange': {
                const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
                const paths = changes.map((change) => str(change.path) ?? '').filter((path) => path !== '');
                this.upsertTool(
                    id,
                    'ApplyPatch',
                    {
                        summary: paths.join(', '),
                        changes: changes.map((change) => ({ path: str(change.path) ?? '', kind: change.kind, diff: str(change.diff) ?? '' }))
                    },
                    completed ? changes.map((change) => str(change.diff) ?? '').join('\n') : null,
                    completed ? (str(item.status) === 'completed' ? 'done' : 'error') : 'running',
                    out
                );
                return;
            }
            case 'mcpToolCall': {
                const result = isRecord(item.result) ? textOf(item.result.content) : '';
                const error = isRecord(item.error) ? (str(item.error.message) ?? '') : '';
                this.upsertTool(
                    id,
                    `${str(item.server) ?? 'mcp'}/${str(item.tool) ?? 'tool'}`,
                    item.arguments ?? {},
                    completed ? error || result : null,
                    completed ? (str(item.status) === 'completed' ? 'done' : 'error') : 'running',
                    out
                );
                return;
            }
            case 'dynamicToolCall':
                this.upsertTool(
                    id,
                    str(item.tool) ?? 'tool',
                    item.arguments ?? {},
                    completed ? textOf(item.contentItems) : null,
                    completed ? (item.success === false ? 'error' : 'done') : 'running',
                    out
                );
                return;
            case 'webSearch': {
                const action = isRecord(item.action) ? item.action : {};
                this.upsertTool(
                    id,
                    'WebSearch',
                    { query: str(item.query) ?? str(action.query) ?? '' },
                    completed ? '' : null,
                    completed ? 'done' : 'running',
                    out
                );
                return;
            }
            case 'contextCompaction':
                if (completed) {
                    out.events.push(
                        this.thread.upsert({
                            id: `compaction-${id}`,
                            kind: 'compaction',
                            createdAt: this.now(),
                            turnId: this.thread.info.activeTurnId,
                            preTokens: this.thread.info.usage.contextTokens > 0 ? this.thread.info.usage.contextTokens : null
                        })
                    );
                }
                return;
            default:
                return;
        }
    }

    private handleDelta(params: Frame, out: CodexReducerOutput): void {
        const id = str(params.itemId);
        const text = str(params.delta);
        if (!id || !text) {
            return;
        }
        if (!this.thread.get(id)) {
            this.upsertAssistant(id, '', true, out);
        }
        const delta = this.thread.appendText(id, text);
        if (delta) {
            out.events.push(delta);
        }
    }

    private handleUsage(params: Frame, out: CodexReducerOutput): void {
        const usage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
        const last = isRecord(usage.last) ? usage.last : {};
        const contextWindow = num(usage.modelContextWindow);
        out.events.push(
            this.thread.patchInfo({
                usage: {
                    ...this.thread.info.usage,
                    contextTokens: num(last.totalTokens),
                    contextWindow: contextWindow > 0 ? contextWindow : this.thread.info.usage.contextWindow
                }
            })
        );
    }

    private handleTurnCompleted(params: Frame, out: CodexReducerOutput): void {
        const turn = isRecord(params.turn) ? params.turn : {};
        const status = str(turn.status);
        const error = isRecord(turn.error) ? str(turn.error.message) : null;
        if (status === 'failed') {
            out.events.push(this.note('error', error ?? 'The turn failed'));
        }
        this.settleOpenItems(out);
        this.closeTurn(status === 'interrupted' ? 'aborted' : status === 'failed' ? 'error' : 'done', out);
        this.codexTurnId = null;
        out.events.push(
            this.thread.patchInfo({ status: 'idle', activeTurnId: null, usage: { ...this.thread.info.usage, turns: this.thread.info.usage.turns + 1 } })
        );
    }

    private handleError(params: Frame, out: CodexReducerOutput): void {
        const error = isRecord(params.error) ? params.error : {};
        const message = str(error.message) ?? 'Codex reported an error';
        out.events.push(this.note(params.willRetry === true ? 'warning' : 'error', message));
    }

    private cancelRequest(rpcId: unknown, out: CodexReducerOutput): void {
        if (typeof rpcId !== 'number' && typeof rpcId !== 'string') {
            return;
        }
        const requestId = `${this.generation}-${rpcId}`;
        const approval = this.thread.get(`approval-${requestId}`);
        if (approval?.kind === 'approval' && approval.decision === 'pending') {
            out.events.push(this.thread.upsert({ ...approval, decision: 'cancelled' }));
            out.events.push(this.thread.setStatus('running'));
        }
        const question = this.thread.get(`question-${requestId}`);
        if (question?.kind === 'question' && question.state === 'pending') {
            out.events.push(this.thread.upsert({ ...question, state: 'cancelled' }));
            out.events.push(this.thread.setStatus('running'));
        }
    }

    private upsertAssistant(id: string, text: string, streaming: boolean, out: CodexReducerOutput): void {
        const existing = this.thread.get(id);
        out.events.push(
            this.thread.upsert({
                id,
                kind: 'assistant',
                createdAt: existing?.createdAt ?? this.now(),
                turnId: existing?.turnId ?? this.thread.info.activeTurnId,
                text,
                streaming
            })
        );
    }

    private upsertTool(id: string, name: string, input: unknown, output: string | null, state: ChatToolItem['state'], out: CodexReducerOutput): void {
        const existing = this.thread.get(id);
        out.events.push(
            this.thread.upsert({
                id,
                kind: 'tool',
                createdAt: existing?.createdAt ?? this.now(),
                turnId: existing?.turnId ?? this.thread.info.activeTurnId,
                toolUseId: id,
                name,
                input,
                output: output ?? (existing?.kind === 'tool' ? existing.output : null),
                state,
                parentToolUseId: null
            })
        );
    }

    private questionItem(requestId: string, questions: ChatQuestion[]): ChatEvent {
        return this.thread.upsert({
            id: `question-${requestId}`,
            kind: 'question',
            createdAt: this.now(),
            turnId: this.thread.info.activeTurnId,
            requestId,
            questions,
            answers: null,
            state: 'pending'
        });
    }

    private settleOpenItems(out: CodexReducerOutput): void {
        for (const item of this.thread.list()) {
            if (item.kind === 'assistant' && item.streaming) {
                out.events.push(this.thread.upsert({ ...item, streaming: false }));
            } else if (item.kind === 'approval' && item.decision === 'pending') {
                out.events.push(this.thread.upsert({ ...item, decision: 'cancelled' }));
            } else if (item.kind === 'question' && item.state === 'pending') {
                out.events.push(this.thread.upsert({ ...item, state: 'cancelled' }));
            } else if (item.kind === 'tool' && item.state === 'running') {
                out.events.push(this.thread.upsert({ ...item, state: 'error' }));
            }
        }
    }

    private closeTurn(state: 'done' | 'aborted' | 'error', out: CodexReducerOutput): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (!turn || turn.kind !== 'turn') {
            return;
        }
        // Codex reports no cost; the turn keeps a zero so the fold label can still say how long it took.
        out.events.push(this.thread.upsert({ ...turn, state, endedAt: this.now(), costUsd: 0 }));
    }

    note(level: 'info' | 'warning' | 'error', text: string): ChatEvent {
        const item: ChatItem = {
            id: `note-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'note',
            createdAt: this.now(),
            turnId: this.thread.info.activeTurnId,
            level,
            text
        };
        return this.thread.upsert(item);
    }
}
