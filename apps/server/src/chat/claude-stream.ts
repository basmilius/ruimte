import type { ChatEvent, ChatItem, ChatQuestion } from '@ruimte/contracts';
import type { ChatThread } from './thread.ts';

/*
 * What the CLI wants back on stdin. Both are `can_use_tool` requests the person has to answer;
 * the session keeps them until `chat.approve` or `chat.answer` arrives.
 */
export type ReducerAction =
    | { type: 'approval'; requestId: string; toolUseId: string | null; input: unknown; suggestions: unknown[] }
    | { type: 'question'; requestId: string; toolUseId: string | null; input: unknown };

export interface ReducerOutput {
    events: ChatEvent[];
    actions: ReducerAction[];
}

type Frame = Record<string, unknown>;

const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// A tool result is a string or a list of content blocks; only the text is worth showing.
const resultText = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .map((block) => (isRecord(block) && block.type === 'text' ? str(block.text) : null))
        .filter((text): text is string => text !== null)
        .join('\n');
};

const contextTokens = (usage: unknown): number =>
    isRecord(usage) ? num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens) : 0;

// The CLI's AskUserQuestion input, as far as the person needs to see it.
export const parseQuestions = (input: unknown): ChatQuestion[] => {
    if (!isRecord(input) || !Array.isArray(input.questions)) {
        return [];
    }
    return input.questions.filter(isRecord).map((question, index) => ({
        id: String(index),
        header: str(question.header) ?? '',
        question: str(question.question) ?? '',
        choices: Array.isArray(question.options)
            ? question.options.filter(isRecord).map((option) => ({ label: str(option.label) ?? '', description: str(option.description) ?? '' }))
            : [],
        multiSelect: question.multiSelect === true
    }));
};

/*
 * Folds the CLI's stream-json frames into thread events. Text is keyed by message id plus the
 * ordinal of the text block inside that message, because the streaming events and the final
 * `assistant` frames number their blocks differently (the final frames arrive one block at a time).
 */
export class ClaudeStreamReducer {
    private readonly thread: ChatThread;
    private readonly now: () => number;
    private streamMessageId: string | null = null;
    private streamTextCount = 0;
    // Stream block index to the id of the assistant item collecting its deltas.
    private readonly streamBlocks = new Map<number, string>();
    private readonly frameTextCount = new Map<string, number>();
    private interrupted = false;
    // Bumped per CLI process, so message ids of a resumed session never overwrite older text items.
    private generation = 0;

    constructor(thread: ChatThread, now: () => number = Date.now) {
        this.thread = thread;
        this.now = now;
    }

    /* The person asked to stop; the result that follows closes the turn as aborted. */
    markInterrupted(): void {
        this.interrupted = true;
    }

    /* A fresh CLI process is about to talk; its message numbering starts over. */
    nextProcess(): void {
        this.generation += 1;
        this.frameTextCount.clear();
        this.streamBlocks.clear();
        this.streamMessageId = null;
    }

    handle(frame: unknown): ReducerOutput {
        const out: ReducerOutput = { events: [], actions: [] };
        if (!isRecord(frame)) {
            return out;
        }
        switch (frame.type) {
            case 'system':
                this.handleSystem(frame, out);
                break;
            case 'stream_event':
                this.handleStreamEvent(frame, out);
                break;
            case 'assistant':
                this.handleAssistant(frame, out);
                break;
            case 'user':
                this.handleUser(frame, out);
                break;
            case 'result':
                this.handleResult(frame, out);
                break;
            case 'control_request':
                this.handleControlRequest(frame, out);
                break;
            case 'control_cancel_request':
                this.cancelRequest(str(frame.request_id), out);
                break;
            default:
                break;
        }
        return out;
    }

    /* The process went away; whatever was open is closed with the reason on the thread. */
    finish(exitCode: number | null, out: ReducerOutput = { events: [], actions: [] }): ReducerOutput {
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
        const busy = this.thread.info.status === 'running' || this.thread.info.status === 'needs-you';
        if (busy || (exitCode !== null && exitCode !== 0)) {
            out.events.push(this.note('error', exitCode === null ? 'Claude Code stopped' : `Claude Code exited with code ${exitCode}`));
        }
        this.closeTurn(busy ? 'error' : 'done', 0, out);
        out.events.push(this.thread.patchInfo({ running: false, status: busy ? 'error' : 'idle', activeTurnId: null }));
        return out;
    }

    private handleSystem(frame: Frame, out: ReducerOutput): void {
        if (frame.subtype === 'init') {
            const commands = Array.isArray(frame.slash_commands) ? frame.slash_commands.filter((c): c is string => typeof c === 'string') : [];
            out.events.push(
                this.thread.patchInfo({
                    agentSessionId: str(frame.session_id) ?? this.thread.info.agentSessionId,
                    model: str(frame.model) ?? this.thread.info.model,
                    slashCommands: commands.length > 0 ? commands : this.thread.info.slashCommands,
                    running: true
                })
            );
        } else if (frame.subtype === 'compact_boundary') {
            const meta = isRecord(frame.compact_metadata) ? frame.compact_metadata : {};
            const preTokens = num(meta.pre_tokens);
            out.events.push(
                this.thread.upsert({
                    id: `compaction-${this.now()}`,
                    kind: 'compaction',
                    createdAt: this.now(),
                    turnId: this.thread.info.activeTurnId,
                    preTokens: preTokens > 0 ? preTokens : null
                })
            );
        }
    }

    private handleStreamEvent(frame: Frame, out: ReducerOutput): void {
        const event = frame.event;
        if (!isRecord(event) || str(frame.parent_tool_use_id)) {
            return;
        }
        if (event.type === 'message_start') {
            const message = isRecord(event.message) ? event.message : {};
            this.streamMessageId = str(message.id);
            this.streamTextCount = 0;
            this.streamBlocks.clear();
            return;
        }
        const index = num(event.index);
        if (event.type === 'content_block_start' && isRecord(event.content_block) && event.content_block.type === 'text' && this.streamMessageId) {
            const id = this.textItemId(this.streamMessageId, this.streamTextCount++);
            this.streamBlocks.set(index, id);
            out.events.push(
                this.thread.upsert({
                    id,
                    kind: 'assistant',
                    createdAt: this.now(),
                    turnId: this.thread.info.activeTurnId,
                    text: str(event.content_block.text) ?? '',
                    streaming: true
                })
            );
            return;
        }
        if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta') {
            const id = this.streamBlocks.get(index);
            const text = str(event.delta.text);
            if (id && text) {
                const delta = this.thread.appendText(id, text);
                if (delta) {
                    out.events.push(delta);
                }
            }
        }
    }

    private handleAssistant(frame: Frame, out: ReducerOutput): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const messageId = str(message.id) ?? 'message';
        const parentToolUseId = str(frame.parent_tool_use_id);
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block)) {
                continue;
            }
            if (block.type === 'text' && !parentToolUseId) {
                const ordinal = this.frameTextCount.get(messageId) ?? 0;
                this.frameTextCount.set(messageId, ordinal + 1);
                const id = this.textItemId(messageId, ordinal);
                const existing = this.thread.get(id);
                out.events.push(
                    this.thread.upsert({
                        id,
                        kind: 'assistant',
                        createdAt: existing?.createdAt ?? this.now(),
                        turnId: existing?.turnId ?? this.thread.info.activeTurnId,
                        text: str(block.text) ?? '',
                        streaming: false
                    })
                );
            } else if (block.type === 'tool_use') {
                const toolUseId = str(block.id) ?? `tool-${this.now()}`;
                const existing = this.thread.get(toolUseId);
                out.events.push(
                    this.thread.upsert({
                        id: toolUseId,
                        kind: 'tool',
                        createdAt: existing?.createdAt ?? this.now(),
                        turnId: existing?.turnId ?? this.thread.info.activeTurnId,
                        toolUseId,
                        name: str(block.name) ?? 'tool',
                        input: block.input ?? {},
                        output: existing?.kind === 'tool' ? existing.output : null,
                        state: existing?.kind === 'tool' ? existing.state : 'running',
                        parentToolUseId
                    })
                );
            }
        }
        const usage = parentToolUseId ? 0 : contextTokens(message.usage);
        if (usage > 0) {
            out.events.push(this.thread.patchInfo({ usage: { ...this.thread.info.usage, contextTokens: usage } }));
        }
        const error = str(frame.error);
        if (error) {
            out.events.push(this.note('error', `The request failed: ${error.replaceAll('_', ' ')}`));
        }
    }

    private handleUser(frame: Frame, out: ReducerOutput): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block) || block.type !== 'tool_result') {
                continue;
            }
            const toolUseId = str(block.tool_use_id);
            const tool = toolUseId ? this.thread.get(toolUseId) : undefined;
            if (!tool || tool.kind !== 'tool') {
                continue;
            }
            out.events.push(this.thread.upsert({ ...tool, output: resultText(block.content), state: block.is_error === true ? 'error' : 'done' }));
        }
    }

    private handleResult(frame: Frame, out: ReducerOutput): void {
        for (const item of this.thread.list()) {
            if (item.kind === 'assistant' && item.streaming) {
                out.events.push(this.thread.upsert({ ...item, streaming: false }));
            }
        }
        const failed = frame.is_error === true || (typeof frame.subtype === 'string' && frame.subtype.startsWith('error'));
        if (failed) {
            const errors = Array.isArray(frame.errors) ? frame.errors.filter((e): e is string => typeof e === 'string') : [];
            out.events.push(this.note('error', errors[0] ?? `The turn ended with ${str(frame.subtype) ?? 'an error'}`));
        }
        const model = this.thread.info.model;
        const modelUsage = isRecord(frame.modelUsage) && model && isRecord(frame.modelUsage[model]) ? frame.modelUsage[model] : null;
        const contextWindow = modelUsage ? num(modelUsage.contextWindow) : 0;
        const cost = num(frame.total_cost_usd);
        this.closeTurn(this.interrupted ? 'aborted' : failed ? 'error' : 'done', cost, out);
        this.interrupted = false;
        out.events.push(
            this.thread.patchInfo({
                status: 'idle',
                activeTurnId: null,
                usage: {
                    ...this.thread.info.usage,
                    costUsd: cost || this.thread.info.usage.costUsd,
                    turns: this.thread.info.usage.turns + 1,
                    contextWindow: contextWindow > 0 ? contextWindow : this.thread.info.usage.contextWindow
                }
            })
        );
    }

    private closeTurn(state: 'done' | 'aborted' | 'error', costUsd: number, out: ReducerOutput): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (!turn || turn.kind !== 'turn') {
            return;
        }
        out.events.push(this.thread.upsert({ ...turn, state, endedAt: this.now(), costUsd: Math.max(0, costUsd - (this.thread.info.usage.costUsd || 0)) }));
    }

    private handleControlRequest(frame: Frame, out: ReducerOutput): void {
        const request = isRecord(frame.request) ? frame.request : {};
        const requestId = str(frame.request_id);
        if (!requestId || request.subtype !== 'can_use_tool') {
            return;
        }
        const toolUseId = str(request.tool_use_id);
        const toolName = str(request.tool_name) ?? 'tool';
        if (toolName === 'AskUserQuestion') {
            const questions = parseQuestions(request.input);
            if (questions.length === 0) {
                return;
            }
            out.events.push(
                this.thread.upsert({
                    id: `question-${requestId}`,
                    kind: 'question',
                    createdAt: this.now(),
                    turnId: this.thread.info.activeTurnId,
                    requestId,
                    questions,
                    answers: null,
                    state: 'pending'
                })
            );
            out.events.push(this.thread.setStatus('needs-you'));
            out.actions.push({ type: 'question', requestId, toolUseId, input: request.input });
            return;
        }
        const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
        out.events.push(
            this.thread.upsert({
                id: `approval-${requestId}`,
                kind: 'approval',
                createdAt: this.now(),
                turnId: this.thread.info.activeTurnId,
                requestId,
                toolUseId,
                toolName,
                input: request.input ?? {},
                description: str(request.description),
                canAllowAlways: suggestions.length > 0,
                decision: 'pending'
            })
        );
        out.events.push(this.thread.setStatus('needs-you'));
        out.actions.push({ type: 'approval', requestId, toolUseId, input: request.input ?? {}, suggestions });
    }

    private cancelRequest(requestId: string | null, out: ReducerOutput): void {
        const approval = requestId ? this.thread.get(`approval-${requestId}`) : undefined;
        if (approval?.kind === 'approval' && approval.decision === 'pending') {
            out.events.push(this.thread.upsert({ ...approval, decision: 'cancelled' }));
            out.events.push(this.thread.setStatus('running'));
        }
        const question = requestId ? this.thread.get(`question-${requestId}`) : undefined;
        if (question?.kind === 'question' && question.state === 'pending') {
            out.events.push(this.thread.upsert({ ...question, state: 'cancelled' }));
            out.events.push(this.thread.setStatus('running'));
        }
    }

    private textItemId(messageId: string, ordinal: number): string {
        return `${this.generation}:${messageId}:t${ordinal}`;
    }

    private note(level: 'info' | 'warning' | 'error', text: string): ChatEvent {
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
