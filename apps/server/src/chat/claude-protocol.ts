import type { ChatQuestion } from '@ruimte/contracts';
import type { ApprovalDecision, BackendEvent } from './backend.ts';

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
const parseQuestions = (input: unknown): ChatQuestion[] => {
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

// What the CLI waits for on stdin, kept until `chat.approve` or `chat.answer` names the request.
type Pending =
    { type: 'approval'; toolUseId: string | null; input: unknown; suggestions: unknown[] } | { type: 'question'; toolUseId: string | null; input: unknown };

/*
 * Claude Code's stream-json frames, in and out. Text is keyed by message id plus the ordinal of the
 * text block inside that message, because the streaming events and the final `assistant` frames
 * number their blocks differently (the final frames arrive one block at a time). One instance
 * belongs to one process, so a resumed CLI that numbers its messages from the start gets its own.
 */
export class ClaudeProtocol {
    private readonly pending = new Map<string, Pending>();
    private streamMessageId: string | null = null;
    private streamTextCount = 0;
    // Stream block index to the ref of the text block collecting its deltas.
    private readonly streamBlocks = new Map<number, string>();
    private readonly frameTextCount = new Map<string, number>();
    // What the CLI called its model, which is the key its result frame reports usage under.
    private model: string | null = null;

    handle(frame: unknown): BackendEvent[] {
        const events: BackendEvent[] = [];
        if (!isRecord(frame)) {
            return events;
        }
        switch (frame.type) {
            case 'system':
                this.handleSystem(frame, events);
                break;
            case 'stream_event':
                this.handleStreamEvent(frame, events);
                break;
            case 'assistant':
                this.handleAssistant(frame, events);
                break;
            case 'user':
                this.handleUser(frame, events);
                break;
            case 'result':
                this.handleResult(frame, events);
                break;
            case 'control_request':
                this.handleControlRequest(frame, events);
                break;
            case 'control_cancel_request': {
                const requestId = str(frame.request_id);
                if (requestId) {
                    this.pending.delete(requestId);
                    events.push({ type: 'request.withdrawn', requestId });
                }
                break;
            }
            case 'tool_progress':
                this.handleToolProgress(frame, events);
                break;
            default:
                break;
        }
        return events;
    }

    /* The `control_response` that answers a permission request, or null when nothing waits under that id. */
    approvalResponse(requestId: string, decision: ApprovalDecision, message?: string): unknown | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'approval') {
            return null;
        }
        this.pending.delete(requestId);
        const toolUseID = pending.toolUseId ?? undefined;
        const response =
            decision === 'deny'
                ? { behavior: 'deny', message: message?.trim() || 'The user declined this action', toolUseID }
                : {
                      behavior: 'allow',
                      updatedInput: pending.input,
                      toolUseID,
                      // The CLI's own suggestion of a rule; sending it back is what makes "always" stick.
                      ...(decision === 'allow-always' && pending.suggestions.length > 0 ? { updatedPermissions: pending.suggestions } : {})
                  };
        return { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } };
    }

    /* The `control_response` that answers an AskUserQuestion, or null when nothing waits under that id. */
    questionResponse(requestId: string, answers: Record<string, string>): unknown | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'question') {
            return null;
        }
        this.pending.delete(requestId);
        // The CLI keys answers by the question text, the client by the question's id.
        const byText: Record<string, string> = {};
        for (const question of parseQuestions(pending.input)) {
            const given = answers[question.id];
            if (given !== undefined) {
                byText[question.question] = given;
            }
        }
        const input = isRecord(pending.input) ? pending.input : {};
        return {
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: requestId,
                response: { behavior: 'allow', updatedInput: { ...input, answers: byText }, toolUseID: pending.toolUseId ?? undefined }
            }
        };
    }

    forgetPending(): void {
        this.pending.clear();
    }

    private handleSystem(frame: Frame, events: BackendEvent[]): void {
        if (frame.subtype === 'init') {
            const commands = Array.isArray(frame.slash_commands)
                ? frame.slash_commands.filter((command): command is string => typeof command === 'string')
                : [];
            const skills = Array.isArray(frame.skills) ? frame.skills.filter((skill): skill is string => typeof skill === 'string') : [];
            this.model = str(frame.model) ?? this.model;
            events.push({ type: 'session', agentSessionId: str(frame.session_id), model: str(frame.model), slashCommands: commands, skills });
        } else if (frame.subtype === 'task_started' || frame.subtype === 'task_progress') {
            // A Bash call or a subagent became a task; its description is the CLI's own words for the work.
            const ref = str(frame.tool_use_id);
            const description = str(frame.description);
            if (ref && description) {
                events.push({ type: 'tool.progress', ref, startedAt: null, description });
            }
        } else if (frame.subtype === 'task_notification') {
            // The CLI wakes the main agent itself when a background task settles; this frame is the only
            // thing that says what it was about, and it arrives before the turn nobody asked for.
            events.push({
                type: 'task.done',
                ref: str(frame.tool_use_id),
                summary: str(frame.summary),
                ok: str(frame.status) === 'completed'
            });
        } else if (frame.subtype === 'compact_boundary') {
            const meta = isRecord(frame.compact_metadata) ? frame.compact_metadata : {};
            const preTokens = num(meta.pre_tokens);
            events.push({ type: 'compaction', preTokens: preTokens > 0 ? preTokens : null });
        }
    }

    private handleStreamEvent(frame: Frame, events: BackendEvent[]): void {
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
            const ref = this.textRef(this.streamMessageId, this.streamTextCount++);
            this.streamBlocks.set(index, ref);
            events.push({ type: 'text.delta', ref, text: str(event.content_block.text) ?? '' });
            return;
        }
        if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta') {
            const ref = this.streamBlocks.get(index);
            const text = str(event.delta.text);
            if (ref && text) {
                events.push({ type: 'text.delta', ref, text });
            }
        }
    }

    private handleAssistant(frame: Frame, events: BackendEvent[]): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const messageId = str(message.id) ?? 'message';
        const parentRef = str(frame.parent_tool_use_id);
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block)) {
                continue;
            }
            if (block.type === 'text' && !parentRef) {
                const ordinal = this.frameTextCount.get(messageId) ?? 0;
                this.frameTextCount.set(messageId, ordinal + 1);
                events.push({ type: 'text.done', ref: this.textRef(messageId, ordinal), text: str(block.text) ?? '' });
            } else if (block.type === 'tool_use') {
                events.push({
                    type: 'tool.started',
                    ref: str(block.id) ?? `tool-${Date.now()}`,
                    name: str(block.name) ?? 'tool',
                    input: block.input ?? {},
                    parentRef
                });
            }
        }
        const tokens = parentRef ? 0 : contextTokens(message.usage);
        if (tokens > 0) {
            events.push({ type: 'usage', contextTokens: tokens });
        }
        const error = str(frame.error);
        if (error) {
            events.push({ type: 'note', level: 'error', text: `The request failed: ${error.replaceAll('_', ' ')}` });
        }
    }

    /*
     * `tool_progress` carries how long the call has run (once per 30 s for a Bash under the CLI's
     * remote gate, or a heartbeat for a slow MCP tool); the start is kept so the client can count on.
     */
    private handleToolProgress(frame: Frame, events: BackendEvent[]): void {
        const elapsed = frame.elapsed_time_seconds;
        const ref = str(frame.tool_use_id);
        if (!ref || typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) {
            return;
        }
        events.push({ type: 'tool.progress', ref, startedAt: Date.now() - Math.round(elapsed * 1000), description: null });
    }

    private handleUser(frame: Frame, events: BackendEvent[]): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block) || block.type !== 'tool_result') {
                continue;
            }
            const ref = str(block.tool_use_id);
            if (ref) {
                events.push({ type: 'tool.done', ref, output: resultText(block.content), state: block.is_error === true ? 'error' : 'done' });
            }
        }
    }

    private handleResult(frame: Frame, events: BackendEvent[]): void {
        const failed = frame.is_error === true || (typeof frame.subtype === 'string' && frame.subtype.startsWith('error'));
        const errors = Array.isArray(frame.errors) ? frame.errors.filter((error): error is string => typeof error === 'string') : [];
        const modelUsage = isRecord(frame.modelUsage) && this.model ? frame.modelUsage[this.model] : undefined;
        const contextWindow = isRecord(modelUsage) ? num(modelUsage.contextWindow) : 0;
        if (contextWindow > 0) {
            events.push({ type: 'usage', contextWindow });
        }
        events.push({
            type: 'turn.done',
            state: failed ? 'error' : 'done',
            costUsd: num(frame.total_cost_usd),
            ...(failed ? { error: errors[0] ?? `The turn ended with ${str(frame.subtype) ?? 'an error'}` } : {})
        });
    }

    private handleControlRequest(frame: Frame, events: BackendEvent[]): void {
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
            this.pending.set(requestId, { type: 'question', toolUseId, input: request.input });
            events.push({ type: 'question.requested', requestId, questions });
            return;
        }
        const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
        this.pending.set(requestId, { type: 'approval', toolUseId, input: request.input ?? {}, suggestions });
        events.push({
            type: 'approval.requested',
            requestId,
            ref: toolUseId,
            toolName,
            input: request.input ?? {},
            description: str(request.description),
            canAllowAlways: suggestions.length > 0
        });
    }

    private textRef(messageId: string, ordinal: number): string {
        return `${messageId}:t${ordinal}`;
    }
}
