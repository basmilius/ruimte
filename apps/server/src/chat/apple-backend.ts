import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AppleFoundationEventSchema, type AppleFoundationEvent, type AppleFoundationRequest } from '@ruimte/contracts';
import { closeAppleNetworkTools } from './apple-network-tools.ts';
import { APPLE_TOOL_NAMES, appleToolInput, executeAppleTool, type AppleToolCall, type AppleToolContext, type AppleToolResult } from './apple-tools.ts';
import type { ApprovalDecision, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { ChatChild } from './chat-process.ts';

export interface AppleBackendOptions {
    enabled?: () => boolean;
    schedule?: (callback: () => void, milliseconds: number) => () => void;
    onMetrics?: (metrics: Extract<AppleFoundationEvent, { type: 'metrics' }>) => void;
}

export class AppleBackend implements ChatBackend {
    private child: ChatChild | null = null;
    private ready: Promise<void> | null = null;
    private resolveReady: (() => void) | null = null;
    private rejectReady: ((error: Error) => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private turn: string | null = null;
    private ordinal = 0;
    private text = '';
    private interrupted = false;
    private closed = false;
    private seenTools = new Set<string>();
    private pending = new Map<string, AppleToolCall>();
    private executing = new Map<string, AbortController>();
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly executeTool: typeof executeAppleTool;
    private readonly options: AppleBackendOptions;
    private readonly sessionId: string;
    private readonly home: string;
    private readonly toolContext: AppleToolContext;
    private readonly questions = new Set<string>();
    private cancelDeadline: (() => void) | null = null;
    private readonly toolDeadlines = new Map<string, () => void>();
    private terminalError: { state: 'aborted' | 'error'; message: string } | null = null;
    private contextWindow: number | undefined;

    constructor(launch: BackendLaunch, host: BackendHost, executeTool = executeAppleTool, options: AppleBackendOptions = {}) {
        this.launch = launch;
        this.host = host;
        this.executeTool = executeTool;
        this.options = options;
        this.sessionId = (launch.resume ?? randomUUID()).toLowerCase();
        this.home = launch.env.RUIMTE_HOME ?? join(launch.env.HOME ?? homedir(), '.ruimte');
        this.toolContext = { env: launch.env, home: this.home, runtimeMode: launch.runtimeMode };
    }

    get running(): boolean {
        return this.child !== null;
    }
    get pid(): number | null {
        return this.child?.pid ?? null;
    }

    start(): Promise<void> {
        if (this.ready) {
            return this.ready;
        }
        this.ready = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.timer = setTimeout(() => this.fail('Apple Foundation Models helper did not become ready within 15 seconds.'), 15_000);
        try {
            this.requireEnabled();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.sessionId)) {
                throw new Error('The Apple conversation id is invalid.');
            }
            this.child = new ChatChild({
                command: [...this.launch.command, '--session', this.sessionId, '--home', this.home, ...(this.launch.resume ? ['--resume'] : [])],
                cwd: this.launch.cwd,
                env: this.launch.env,
                ...(this.launch.spawn ? { spawn: this.launch.spawn } : {}),
                onExit: (exitCode, stderr) => {
                    this.closed = true;
                    void closeAppleNetworkTools(this.toolContext);
                    this.clearTimer();
                    this.clearDeadline();
                    this.rejectReady?.(new Error('Apple Foundation Models helper exited before it was ready.'));
                    this.rejectReady = null;
                    this.child = null;
                    this.withdraw();
                    this.host.onEvent({ type: 'exit', exitCode, ...(stderr ? { stderr } : {}) });
                }
            });
            void this.read(this.child.process.stdout);
        } catch (error) {
            this.fail(String(error));
        }
        return this.ready;
    }

    sendTurn(input: TurnInput): void {
        this.requireEnabled();
        if (this.closed) {
            throw new Error('The Apple Foundation Models helper has stopped.');
        }
        if (this.turn !== null) {
            throw new Error('Apple Foundation Models already has a running turn.');
        }
        const prompt = [input.preamble, input.text].filter(Boolean).join('\n\n');
        if (input.attachments.length || input.mentions.length || input.skills.length || Buffer.byteLength(prompt) > 6000) {
            this.host.onEvent({
                type: 'turn.done',
                state: 'error',
                costUsd: 0,
                error: 'Apple Foundation Models accepts text only, up to 6000 UTF-8 bytes. Attachments, file mentions and skills are unavailable.'
            });
            return;
        }
        this.turn = `${this.launch.generation}-${++this.ordinal}`;
        this.text = '';
        this.interrupted = false;
        this.terminalError = null;
        this.seenTools.clear();
        if (this.ordinal === 1) {
            this.host.onEvent({
                type: 'note',
                level: 'info',
                text: 'Apple runs locally and saves conversation memory on this machine. Older context may be summarized; the original history stays saved. Tools ask for approval. Commands and MCP tools can access more than the project; review each request. Web and remote MCP calls send their approved inputs to those services.'
            });
        }
        this.write({ type: 'turn', id: this.turn, prompt });
        this.armModelDeadline();
    }

    compact(): void {
        this.requireEnabled();
        if (this.closed) {
            throw new Error('The Apple Foundation Models helper has stopped.');
        }
        if (this.turn) {
            throw new Error('Wait for the active Apple turn to finish before compacting context.');
        }
        this.turn = `${this.launch.generation}-${++this.ordinal}`;
        this.interrupted = false;
        this.terminalError = null;
        this.text = '';
        this.write({ type: 'compact', id: this.turn });
        this.armModelDeadline();
    }

    interrupt(): void {
        if (!this.turn || this.interrupted) {
            return;
        }
        this.interrupted = true;
        this.clearDeadline();
        this.write({ type: 'cancel', id: this.turn });
        this.withdraw();
        this.timer = setTimeout(() => this.fail('Apple Foundation Models did not stop within 5 seconds.'), 5000);
    }

    respondApproval(id: string, decision: ApprovalDecision, message?: string): boolean {
        const call = this.pending.get(id);
        if (!call) {
            return false;
        }
        this.pending.delete(id);
        if (this.options.enabled?.() === false) {
            this.fail('Apple Foundation Models is disabled on this machine.');
            return false;
        }
        if (decision !== 'allow') {
            this.finishTool(id, { output: `Denied by the person${message ? `: ${message.slice(0, 500)}` : '.'}`, failed: true }, 'denied');
        } else {
            const controller = new AbortController();
            this.executing.set(id, controller);
            this.toolDeadlines.set(
                id,
                this.schedule(() => {
                    if (this.executing.get(id) !== controller) {
                        return;
                    }
                    this.executing.delete(id);
                    controller.abort();
                    this.finishTool(id, {
                        output: 'The tool exceeded its 60-second execution limit. It was not retried; any external effects must be checked.',
                        failed: true
                    });
                }, 60_000)
            );
            void this.runTool(call, controller);
        }
        return true;
    }

    private async runTool(call: AppleToolCall, controller: AbortController): Promise<void> {
        const turn = this.turn;
        let result: Awaited<ReturnType<typeof executeAppleTool>>;
        try {
            this.requireEnabled();
            result = await this.executeTool(this.launch.cwd, call, controller.signal, this.toolContext);
        } catch {
            result = { output: 'The local tool could not complete.', failed: true };
        }
        if (controller.signal.aborted || this.turn !== turn || this.executing.get(call.id) !== controller) {
            return;
        }
        this.executing.delete(call.id);
        if (this.options.enabled?.() === false) {
            this.fail('Apple Foundation Models is disabled on this machine.');
            return;
        }
        this.finishTool(call.id, result);
    }

    private finishTool(id: string, result: AppleToolResult, outcome?: 'denied'): void {
        this.toolDeadlines.get(id)?.();
        this.toolDeadlines.delete(id);
        if (!this.turn || this.interrupted || this.closed) {
            return;
        }
        const turn = this.turn;
        if (Buffer.byteLength(result.output) > 6000) {
            result = { output: 'The tool result exceeded the local context output limit.', failed: true };
        }
        this.host.onEvent({
            type: 'tool.done',
            ref: id,
            output: result.output,
            state: result.failed ? 'error' : 'done',
            ...(result.changes ? { changes: result.changes } : {})
        });
        if (!this.interrupted && this.turn === turn) {
            const status = outcome ?? (result.failed ? (result.recoverable ? 'recoverable_error' : 'error') : 'success');
            if (status === 'error' || status === 'denied') {
                // Seal the turn before returning control to a model that may request more tools.
                this.terminalError = { state: status === 'denied' ? 'aborted' : 'error', message: result.output };
            }
            this.write({ type: 'tool.result', id, output: result.output, outcome: status });
            if (this.terminalError) {
                this.interrupted = true;
                this.clearDeadline();
                this.withdraw();
                this.timer = setTimeout(() => this.fail('Apple Foundation Models did not stop after the tool was refused or failed.'), 5000);
            } else {
                this.armModelDeadline();
            }
        }
    }

    respondQuestion(id: string, answers: Record<string, string>): boolean {
        if (!this.questions.has(id)) {
            return false;
        }
        if (this.options.enabled?.() === false) {
            this.fail('Apple Foundation Models is disabled on this machine.');
            return false;
        }
        const answer = answers[id];
        if (typeof answer !== 'string' || Buffer.byteLength(answer) > 5000) {
            return false;
        }
        this.questions.delete(id);
        this.finishTool(id, { output: answer, failed: false });
        return true;
    }
    declineRequest(id: string, message: string): boolean {
        if (this.questions.delete(id)) {
            this.finishTool(id, { output: `Question declined: ${message.slice(0, 500)}`, failed: true }, 'denied');
            return true;
        }
        return this.respondApproval(id, 'deny', message);
    }

    stop(): void {
        void closeAppleNetworkTools(this.toolContext);
        this.interrupt();
        this.clearTimer();
        this.clearDeadline();
        this.child?.process.stdin.end();
        this.child?.endAfterGrace();
    }

    async dispose(): Promise<void> {
        this.closed = true;
        this.interrupted = true;
        this.clearTimer();
        this.clearDeadline();
        this.withdraw();
        await Promise.all([this.child?.end(), closeAppleNetworkTools(this.toolContext)]);
    }

    private write(request: AppleFoundationRequest): void {
        if (this.closed) {
            return;
        }
        try {
            this.child?.process.stdin.write(`${JSON.stringify(request)}\n`);
            this.child?.process.stdin.flush();
        } catch {
            this.fail('The Apple Foundation Models helper could not receive the request.');
        }
    }

    private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for await (const chunk of stream) {
                buffer += decoder.decode(chunk, { stream: true });
                if (buffer.length > 128_000) {
                    throw new Error('Apple helper frame exceeded 128 KB.');
                }
                let end: number;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, end);
                    buffer = buffer.slice(end + 1);
                    this.receive(AppleFoundationEventSchema.parse(JSON.parse(line)));
                }
            }
        } catch (error) {
            this.fail(`Apple helper protocol error: ${String(error)}`);
        }
    }

    private receive(event: AppleFoundationEvent): void {
        if (this.closed) {
            return;
        }
        if (event.type === 'availability') {
            if (!event.available) {
                this.fail(`Apple Foundation Models unavailable: ${event.reason ?? 'unknown reason'}.`);
                return;
            }
            return;
        }
        if (event.type === 'startup.error') {
            this.fail(event.text);
            return;
        }
        if (event.type === 'session') {
            if (event.protocolVersion !== 3) {
                this.fail('This Apple helper is outdated. Rebuild the helper and restart the development server.');
                return;
            }
            if (event.id !== this.sessionId) {
                this.fail('Apple helper returned a different conversation id.');
                return;
            }
            this.clearTimer();
            this.contextWindow = event.contextSize;
            this.host.onEvent({ type: 'session', agentSessionId: event.id, model: 'apple-system' });
            if (event.note) {
                this.host.onEvent({ type: 'note', level: 'info', text: event.note });
            }
            this.resolveReady?.();
            this.resolveReady = null;
            this.rejectReady = null;
            return;
        }
        if (!this.turn) {
            return;
        }
        if (event.type === 'compacted' && event.id === this.turn) {
            this.clearTimer();
            this.clearDeadline();
            this.host.onEvent({ type: 'note', level: 'info', text: event.text });
            this.host.onEvent({ type: 'compaction', preTokens: null });
            this.turn = null;
            this.host.onEvent({ type: 'turn.done', state: this.interrupted ? 'aborted' : 'done', costUsd: 0 });
            return;
        }
        if (event.type === 'context') {
            if (event.id === this.turn) {
                this.host.onEvent({ type: 'note', level: 'info', text: event.text });
            }
            return;
        }
        if (event.type === 'metrics') {
            if (event.id === this.turn) {
                this.options.onMetrics?.(event);
                this.host.onEvent({ type: 'usage', contextTokens: event.contextTokens, contextWindow: this.contextWindow });
            }
            return;
        }
        if (this.interrupted && event.type !== 'done') {
            return;
        }
        if (event.type === 'tool.call') {
            if (!event.id.startsWith(`${this.turn}-tool-`) || this.seenTools.has(event.id)) {
                return;
            }
            if (this.seenTools.size >= 12) {
                this.fail('Apple helper exceeded the twelve tool-call limit.');
                return;
            }
            this.seenTools.add(event.id);
            this.clearDeadline();
            if (this.options.enabled?.() === false) {
                this.fail('Apple Foundation Models is disabled on this machine.');
                return;
            }
            const input = appleToolInput(event);
            const toolName = APPLE_TOOL_NAMES[event.name];
            this.host.onEvent({ type: 'tool.started', ref: event.id, name: toolName, input, parentRef: null });
            if (event.name === 'ask_user') {
                this.questions.add(event.id);
                this.host.onEvent({
                    type: 'question.requested',
                    requestId: event.id,
                    questions: [
                        {
                            id: event.id,
                            header: 'Question',
                            question: event.question,
                            choices: (event.options ?? []).map((label) => ({ label, description: '' })),
                            multiSelect: false
                        }
                    ]
                });
                return;
            }
            this.pending.set(event.id, event);
            this.host.onEvent({
                type: 'approval.requested',
                requestId: event.id,
                ref: event.id,
                toolName,
                input,
                description: approvalDescription(event),
                canAllowAlways: false
            });
        } else if (event.id === this.turn && event.type === 'text.snapshot') {
            // Apple streams cumulative snapshots; only an appended suffix is a delta.
            if (event.text.startsWith(this.text)) {
                const delta = event.text.slice(this.text.length);
                if (delta) {
                    this.host.onEvent({ type: 'text.delta', ref: this.turn, text: delta });
                }
            } else {
                this.host.onEvent({ type: 'text.done', ref: this.turn, text: event.text });
            }
            this.text = event.text;
        } else if (event.id === this.turn && event.type === 'done') {
            this.clearTimer();
            this.clearDeadline();
            this.withdraw();
            if (this.text) {
                this.host.onEvent({ type: 'text.done', ref: this.turn, text: this.text });
            }
            this.turn = null;
            this.host.onEvent({
                type: 'turn.done',
                state: this.terminalError?.state ?? (this.interrupted ? 'aborted' : event.state),
                costUsd: 0,
                ...(this.terminalError ? { error: this.terminalError.message } : event.text ? { error: event.text } : {})
            });
        }
    }

    private withdraw(): void {
        for (const cancel of this.toolDeadlines.values()) {
            cancel();
        }
        this.toolDeadlines.clear();
        for (const id of this.questions) {
            this.host.onEvent({ type: 'request.withdrawn', requestId: id });
            this.host.onEvent({ type: 'tool.done', ref: id, output: 'Cancelled.', state: 'error' });
        }
        this.questions.clear();
        for (const id of this.pending.keys()) {
            this.host.onEvent({ type: 'request.withdrawn', requestId: id });
            this.host.onEvent({ type: 'tool.done', ref: id, output: 'Cancelled.', state: 'error' });
        }
        this.pending.clear();
        for (const [id, controller] of this.executing) {
            controller.abort();
            this.host.onEvent({ type: 'tool.done', ref: id, output: 'Cancelled.', state: 'error' });
        }
        this.executing.clear();
    }

    private requireEnabled(): void {
        if (this.options.enabled?.() === false) {
            throw new Error('Apple Foundation Models is disabled on this machine.');
        }
    }

    private schedule(callback: () => void, milliseconds: number): () => void {
        if (this.options.schedule) {
            return this.options.schedule(callback, milliseconds);
        }
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
    }

    private clearDeadline(): void {
        this.cancelDeadline?.();
        this.cancelDeadline = null;
    }

    private armModelDeadline(): void {
        if (!this.turn || this.interrupted || this.closed || this.pending.size || this.questions.size || this.executing.size) {
            return;
        }
        this.clearDeadline();
        this.cancelDeadline = this.schedule(() => {
            this.terminalError = {
                state: 'error',
                message: 'Apple Foundation Models exceeded its 120-second generation limit. The turn was stopped and was not retried.'
            };
            this.interrupt();
        }, 120_000);
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = null;
    }

    private fail(message: string): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.interrupted = true;
        this.clearTimer();
        this.clearDeadline();
        this.rejectReady?.(new Error(message));
        this.rejectReady = null;
        this.withdraw();
        this.host.onEvent({ type: 'failed', message });
        void this.child?.end();
        void closeAppleNetworkTools(this.toolContext);
    }
}

const approvalDescription = (call: AppleToolCall): string => {
    switch (call.name) {
        case 'list_files':
            return 'List this project directory?';
        case 'read_file':
            return 'Read this project text excerpt into model context?';
        case 'search_files':
            return 'Search project text files for this literal text?';
        case 'edit_file':
            return 'Replace this exact text in the project file?';
        case 'write_file':
            return 'Create this new project file?';
        case 'run_command':
            return 'Run this shell command with this machine account’s access? It is not restricted to the project folder.';
        case 'web_search':
            return 'Send this search query to the configured web search service?';
        case 'fetch_page':
            return 'Request this public web page and read its text into model context?';
        case 'mcp_list_tools':
            return 'Connect to the configured MCP server(s) and list their tools?';
        case 'mcp_call':
            return 'Call this MCP tool? Its server controls the effects and may receive or change external data.';
        case 'ask_user':
            return 'Ask this question?';
    }
};
