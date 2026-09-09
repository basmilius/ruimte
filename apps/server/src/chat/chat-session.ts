import type { Subprocess } from 'bun';
import type { ChatAttachment, ChatEvent, ChatInfo, ChatItem, ContextSource, InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import { contextChangeNote } from '../context/context-note.ts';
import type { ModelCatalog } from '../providers/catalog.ts';
import { claudeArgs, promptPrefix } from '../providers/claude.ts';
import { ClaudeStreamReducer, type ReducerOutput } from './claude-stream.ts';
import { buildUserMessage } from './input.ts';
import { ChatThread } from './thread.ts';

// After stdin closed, a CLI that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

export interface ChatSessionOptions {
    info: ChatInfo;
    items?: ChatItem[];
    // The executable and leading arguments; a test points this at a fake CLI.
    command: string[];
    env: Record<string, string>;
    catalog: ModelCatalog;
    // Whether the person linked something to this chat; the CLI is told where to look when so.
    hasContext(): boolean;
    // The links as they are now; a change between two turns is put in front of the next prompt.
    contextSources?(): ContextSource[];
    emit(event: ChatEvent): void;
    persist(): void;
}

// What a linked agent is told once, so it knows the CLI exists without being nagged every turn.
export const CONTEXT_PROMPT =
    'The person linked context to this chat on their canvas. Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item, whenever it could help.';

export interface ChatSendExtras {
    mentions?: string[];
    attachments?: ChatAttachment[];
}

type Pending =
    { type: 'approval'; toolUseId: string | null; input: unknown; suggestions: unknown[] } | { type: 'question'; toolUseId: string | null; input: unknown };

type ChatProcess = Subprocess<'pipe', 'pipe', 'pipe'>;

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/*
 * One chat: the thread, the reducer that fills it and, once the first message goes out, the
 * CLI process. The process stays alive between turns; a dead one is started again with
 * `--resume` on the next send, which is also how a chat survives a daemon restart and how a
 * changed model or mode takes effect.
 */
export class ChatSession {
    readonly thread: ChatThread;
    private readonly reducer: ClaudeStreamReducer;
    private readonly options: ChatSessionOptions;
    private readonly pending = new Map<string, Pending>();
    private process: ChatProcess | null = null;
    private stdinClosed = false;
    private exitTimer: ReturnType<typeof setTimeout> | null = null;
    // Set by configure: the running process has the old flags, the next send starts a new one.
    private restartPending = false;
    // The links at the previous turn; null until the first turn, whose process hears about them in its system prompt.
    private lastSources: ContextSource[] | null = null;

    constructor(options: ChatSessionOptions) {
        this.options = options;
        this.thread = new ChatThread(options.info, options.items);
        this.reducer = new ClaudeStreamReducer(this.thread);
    }

    get id(): string {
        return this.thread.info.chatId;
    }

    get info(): ChatInfo {
        return this.thread.info;
    }

    get running(): boolean {
        return this.process !== null;
    }

    /* Model, permission or interaction changes; a turn in flight keeps its process until it ends. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; interactionMode?: InteractionMode }): ChatInfo {
        const selection = patch.selection ? this.options.catalog.normalize(patch.selection) : this.thread.info.selection;
        const next: Partial<ChatInfo> = {
            selection,
            runtimeMode: patch.runtimeMode ?? this.thread.info.runtimeMode,
            interactionMode: patch.interactionMode ?? this.thread.info.interactionMode
        };
        const changed =
            JSON.stringify(next.selection) !== JSON.stringify(this.thread.info.selection) ||
            next.runtimeMode !== this.thread.info.runtimeMode ||
            next.interactionMode !== this.thread.info.interactionMode;
        if (!changed) {
            return this.thread.info;
        }
        if (patch.selection) {
            next.usage = { ...this.thread.info.usage, contextWindow: this.options.catalog.contextWindowFor(selection) };
        }
        this.restartPending = this.process !== null;
        this.apply({ events: [this.thread.patchInfo(next)], actions: [] });
        this.options.persist();
        return this.thread.info;
    }

    send(text: string, extras: ChatSendExtras = {}): void {
        const turnId = newId('turn');
        const now = Date.now();
        const note = this.contextNote(text);
        const mentions = extras.mentions?.length ? extras.mentions : undefined;
        const attachments = extras.attachments?.length ? extras.attachments : undefined;
        this.apply({
            events: [
                this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', endedAt: null, costUsd: 0 }),
                ...(note === null ? [] : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note })]),
                this.thread.upsert({ id: newId('user'), kind: 'user', createdAt: now, turnId, text, mentions, attachments }),
                this.thread.patchInfo({ status: 'running', activeTurnId: turnId })
            ],
            actions: []
        });
        this.ensureProcess();
        // The prefix is what the CLI must see first (ultrathink), then the link note, then what was typed.
        const prefix = `${promptPrefix(this.thread.info.selection)}${note === null ? '' : `${note}\n\n`}`;
        this.write(buildUserMessage({ text, attachments, prefix }));
    }

    /* A link made or removed between turns; the agent hears about it once, in front of the next prompt. */
    private contextNote(text: string): string | null {
        // A slash command must stay the first thing the CLI reads; the change waits for a real prompt.
        if (text.startsWith('/')) {
            return null;
        }
        const current = this.options.contextSources?.() ?? [];
        const previous = this.lastSources;
        this.lastSources = current;
        return previous === null ? null : contextChangeNote(previous, current);
    }

    /* Asks the CLI to fold its context; it answers like any other turn. */
    compact(): void {
        this.send('/compact');
    }

    cancel(): void {
        if (!this.process || !this.thread.info.activeTurnId) {
            return;
        }
        this.reducer.markInterrupted();
        this.write({ type: 'control_request', request_id: `interrupt-${Date.now()}`, request: { subtype: 'interrupt' } });
    }

    /* Answers a pending `can_use_tool`; false when nothing waits under that id. */
    approve(requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        const pending = this.pending.get(requestId);
        if (!pending || pending.type !== 'approval' || !item || item.kind !== 'approval' || item.decision !== 'pending') {
            return false;
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
        this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
        this.apply({ events: [this.thread.upsert({ ...item, decision }), this.thread.setStatus('running')], actions: [] });
        return true;
    }

    /* Answers a pending question; false when nothing waits under that id. */
    answer(requestId: string, answers: Record<string, string>): boolean {
        const item = this.thread.get(`question-${requestId}`);
        const pending = this.pending.get(requestId);
        if (!pending || pending.type !== 'question' || !item || item.kind !== 'question' || item.state !== 'pending') {
            return false;
        }
        this.pending.delete(requestId);
        // The CLI keys answers by the question text, the client by the question's index.
        const byText: Record<string, string> = {};
        for (const question of item.questions) {
            const given = answers[question.id];
            if (given !== undefined) {
                byText[question.question] = given;
            }
        }
        const input = typeof pending.input === 'object' && pending.input !== null ? pending.input : {};
        this.write({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: requestId,
                response: { behavior: 'allow', updatedInput: { ...input, answers: byText }, toolUseID: pending.toolUseId ?? undefined }
            }
        });
        this.apply({ events: [this.thread.upsert({ ...item, answers, state: 'answered' }), this.thread.setStatus('running')], actions: [] });
        return true;
    }

    /* Ends the process; the thread stays as it is. */
    stop(): void {
        const process = this.process;
        if (!process) {
            return;
        }
        this.closeStdin();
        this.exitTimer = setTimeout(() => {
            this.exitTimer = null;
            process.kill('SIGTERM');
        }, EXIT_GRACE_MS);
    }

    dispose(): void {
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.process?.kill('SIGKILL');
        this.process = null;
    }

    private ensureProcess(): void {
        if (this.process && this.restartPending) {
            // Let the old one go quietly; its exit must not be read as the chat ending.
            const old = this.process;
            this.process = null;
            this.closeStdin(old);
            setTimeout(() => old.kill('SIGTERM'), EXIT_GRACE_MS);
        }
        this.restartPending = false;
        if (this.process) {
            return;
        }
        const info = this.thread.info;
        const args = [
            ...this.options.command,
            ...claudeArgs({ selection: info.selection, runtimeMode: info.runtimeMode, interactionMode: info.interactionMode, resume: info.agentSessionId })
        ];
        if (this.options.hasContext()) {
            args.push('--append-system-prompt', CONTEXT_PROMPT);
        }
        this.stdinClosed = false;
        this.reducer.nextProcess();
        const process: ChatProcess = Bun.spawn(args, {
            cwd: info.cwd,
            env: this.options.env,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            onExit: (subprocess, exitCode) => this.handleExit(subprocess as ChatProcess, exitCode)
        });
        this.process = process;
        void this.readLines(process);
        this.apply({ events: [this.thread.patchInfo({ running: true })], actions: [] });
    }

    private async readLines(process: ChatProcess): Promise<void> {
        const reader = process.stdout.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                buffered += decoder.decode(value, { stream: true });
                let newline = buffered.indexOf('\n');
                while (newline >= 0) {
                    this.handleLine(process, buffered.slice(0, newline));
                    buffered = buffered.slice(newline + 1);
                    newline = buffered.indexOf('\n');
                }
            }
            if (buffered.trim() !== '') {
                this.handleLine(process, buffered);
            }
        } catch {
            // The process died mid-read; onExit reports it.
        }
    }

    private handleLine(process: ChatProcess, line: string): void {
        if (this.process !== process || line.trim() === '') {
            return;
        }
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            return;
        }
        this.apply(this.reducer.handle(frame));
        if (typeof frame === 'object' && frame !== null && (frame as { type?: unknown }).type === 'result') {
            this.options.persist();
        }
    }

    private apply(out: ReducerOutput): void {
        for (const action of out.actions) {
            this.pending.set(action.requestId, action);
        }
        for (const event of out.events) {
            this.options.emit(event);
        }
    }

    private write(frame: unknown): void {
        const process = this.process;
        if (!process || this.stdinClosed) {
            return;
        }
        try {
            process.stdin.write(`${JSON.stringify(frame)}\n`);
            process.stdin.flush();
        } catch {
            // The exit handler reports a process that is gone.
        }
    }

    private closeStdin(process: ChatProcess | null = this.process): void {
        if (!process) {
            return;
        }
        if (process === this.process) {
            if (this.stdinClosed) {
                return;
            }
            this.stdinClosed = true;
        }
        try {
            process.stdin.end();
        } catch {
            // Already closed by the other side.
        }
    }

    private handleExit(process: ChatProcess, exitCode: number | null): void {
        if (this.process !== process) {
            return;
        }
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.process = null;
        this.pending.clear();
        this.apply(this.reducer.finish(exitCode));
        this.options.persist();
    }
}
