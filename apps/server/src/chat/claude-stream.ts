import type { ChatEvent, ChatItem } from '@ruimte/contracts';
import type { ChatThread } from './thread.ts';

/*
 * What the CLI wants back on stdin. `approval` is a `can_use_tool` request the person has to
 * answer; the session keeps it until `chat.approve` arrives.
 */
export type ReducerAction = { type: 'approval'; requestId: string; toolUseId: string | null };

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

    constructor(thread: ChatThread, now: () => number = Date.now) {
        this.thread = thread;
        this.now = now;
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
                this.cancelApproval(str(frame.request_id), out);
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
            } else if (item.kind === 'tool' && item.state === 'running') {
                out.events.push(this.thread.upsert({ ...item, state: 'error' }));
            }
        }
        const busy = this.thread.info.status === 'running' || this.thread.info.status === 'needs-you';
        if (busy || (exitCode !== null && exitCode !== 0)) {
            out.events.push(this.note('error', exitCode === null ? 'Claude Code stopped' : `Claude Code exited with code ${exitCode}`));
        }
        out.events.push(this.thread.patchInfo({ running: false, status: busy ? 'error' : 'idle' }));
        return out;
    }

    private handleSystem(frame: Frame, out: ReducerOutput): void {
        if (frame.subtype === 'init') {
            out.events.push(
                this.thread.patchInfo({
                    agentSessionId: str(frame.session_id) ?? this.thread.info.agentSessionId,
                    model: str(frame.model) ?? this.thread.info.model,
                    running: true
                })
            );
        } else if (frame.subtype === 'compact_boundary') {
            out.events.push(this.note('info', 'Context compacted'));
        }
    }

    private handleStreamEvent(frame: Frame, out: ReducerOutput): void {
        const event = frame.event;
        if (!isRecord(event)) {
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
            const id = textItemId(this.streamMessageId, this.streamTextCount++);
            this.streamBlocks.set(index, id);
            out.events.push(this.thread.upsert({ id, kind: 'assistant', createdAt: this.now(), text: str(event.content_block.text) ?? '', streaming: true }));
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
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block)) {
                continue;
            }
            if (block.type === 'text') {
                const ordinal = this.frameTextCount.get(messageId) ?? 0;
                this.frameTextCount.set(messageId, ordinal + 1);
                const id = textItemId(messageId, ordinal);
                const existing = this.thread.get(id);
                out.events.push(
                    this.thread.upsert({ id, kind: 'assistant', createdAt: existing?.createdAt ?? this.now(), text: str(block.text) ?? '', streaming: false })
                );
            } else if (block.type === 'tool_use') {
                const toolUseId = str(block.id) ?? `tool-${this.now()}`;
                const existing = this.thread.get(toolUseId);
                out.events.push(
                    this.thread.upsert({
                        id: toolUseId,
                        kind: 'tool',
                        createdAt: existing?.createdAt ?? this.now(),
                        toolUseId,
                        name: str(block.name) ?? 'tool',
                        input: block.input ?? {},
                        output: existing?.kind === 'tool' ? existing.output : null,
                        state: existing?.kind === 'tool' ? existing.state : 'running'
                    })
                );
            }
        }
        const usage = contextTokens(message.usage);
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
        if (frame.is_error === true || (typeof frame.subtype === 'string' && frame.subtype.startsWith('error'))) {
            const errors = Array.isArray(frame.errors) ? frame.errors.filter((e): e is string => typeof e === 'string') : [];
            out.events.push(this.note('error', errors[0] ?? `The turn ended with ${str(frame.subtype) ?? 'an error'}`));
        }
        const model = this.thread.info.model;
        const modelUsage = isRecord(frame.modelUsage) && model && isRecord(frame.modelUsage[model]) ? frame.modelUsage[model] : null;
        const contextWindow = modelUsage ? num(modelUsage.contextWindow) : 0;
        out.events.push(
            this.thread.patchInfo({
                status: 'idle',
                usage: {
                    ...this.thread.info.usage,
                    costUsd: num(frame.total_cost_usd) || this.thread.info.usage.costUsd,
                    turns: this.thread.info.usage.turns + 1,
                    contextWindow: contextWindow > 0 ? contextWindow : this.thread.info.usage.contextWindow
                }
            })
        );
    }

    private handleControlRequest(frame: Frame, out: ReducerOutput): void {
        const request = isRecord(frame.request) ? frame.request : {};
        const requestId = str(frame.request_id);
        if (!requestId || request.subtype !== 'can_use_tool') {
            return;
        }
        const toolUseId = str(request.tool_use_id);
        out.events.push(
            this.thread.upsert({
                id: `approval-${requestId}`,
                kind: 'approval',
                createdAt: this.now(),
                requestId,
                toolUseId,
                toolName: str(request.tool_name) ?? 'tool',
                input: request.input ?? {},
                description: str(request.description),
                decision: 'pending'
            })
        );
        out.events.push(this.thread.setStatus('needs-you'));
        out.actions.push({ type: 'approval', requestId, toolUseId });
    }

    private cancelApproval(requestId: string | null, out: ReducerOutput): void {
        const item = requestId ? this.thread.get(`approval-${requestId}`) : undefined;
        if (!item || item.kind !== 'approval' || item.decision !== 'pending') {
            return;
        }
        out.events.push(this.thread.upsert({ ...item, decision: 'cancelled' }));
        out.events.push(this.thread.setStatus('running'));
    }

    private note(level: 'info' | 'error', text: string): ChatEvent {
        const item: ChatItem = { id: `note-${this.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'note', createdAt: this.now(), level, text };
        return this.thread.upsert(item);
    }
}

const textItemId = (messageId: string, ordinal: number): string => `${messageId}:t${ordinal}`;
