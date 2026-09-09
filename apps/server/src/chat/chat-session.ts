import type { Subprocess } from 'bun';
import type { ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { ClaudeStreamReducer, type ReducerOutput } from './claude-stream.ts';
import { ChatThread } from './thread.ts';

// Base arguments for a chat process; the session adds `--resume` and `--model`.
export const CLAUDE_CHAT_ARGS = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio'
];

// After stdin closed, a CLI that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

export interface ChatSessionOptions {
    info: ChatInfo;
    items?: ChatItem[];
    // The executable and leading arguments; a test points this at a fake CLI.
    command: string[];
    env: Record<string, string>;
    model?: string;
    emit(event: ChatEvent): void;
    persist(): void;
}

interface PendingApproval {
    toolUseId: string | null;
}

type ChatProcess = Subprocess<'pipe', 'pipe', 'pipe'>;

/*
 * One chat: the thread, the reducer that fills it and, once the first message goes out, the
 * CLI process. The process stays alive between turns; a dead one is started again with
 * `--resume` on the next send, which is also how a chat survives a daemon restart.
 */
export class ChatSession {
    readonly thread: ChatThread;
    private readonly reducer: ClaudeStreamReducer;
    private readonly options: ChatSessionOptions;
    private readonly pending = new Map<string, PendingApproval>();
    private process: ChatProcess | null = null;
    private stdinClosed = false;
    private exitTimer: ReturnType<typeof setTimeout> | null = null;

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

    send(text: string): void {
        this.apply({
            events: [
                this.thread.upsert({ id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'user', createdAt: Date.now(), text }),
                this.thread.setStatus('running')
            ],
            actions: []
        });
        this.ensureProcess();
        this.write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: '' });
    }

    cancel(): void {
        if (!this.process) {
            return;
        }
        this.write({ type: 'control_request', request_id: `interrupt-${Date.now()}`, request: { subtype: 'interrupt' } });
    }

    /* Answers a pending `can_use_tool`; false when nothing waits under that id. */
    approve(requestId: string, decision: 'allow' | 'deny', message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        if (!this.pending.delete(requestId) || !item || item.kind !== 'approval' || item.decision !== 'pending') {
            return false;
        }
        const response =
            decision === 'allow'
                ? { behavior: 'allow', updatedInput: item.input, toolUseID: item.toolUseId ?? undefined }
                : { behavior: 'deny', message: message?.trim() || 'The user declined this action', toolUseID: item.toolUseId ?? undefined };
        this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
        this.apply({ events: [this.thread.upsert({ ...item, decision }), this.thread.setStatus('running')], actions: [] });
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
        if (this.process) {
            return;
        }
        const args = [...this.options.command, ...CLAUDE_CHAT_ARGS];
        const resume = this.thread.info.agentSessionId;
        if (resume) {
            args.push('--resume', resume);
        }
        if (this.options.model) {
            args.push('--model', this.options.model);
        }
        this.stdinClosed = false;
        const process: ChatProcess = Bun.spawn(args, {
            cwd: this.thread.info.cwd,
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
                    this.handleLine(buffered.slice(0, newline));
                    buffered = buffered.slice(newline + 1);
                    newline = buffered.indexOf('\n');
                }
            }
            if (buffered.trim() !== '') {
                this.handleLine(buffered);
            }
        } catch {
            // The process died mid-read; onExit reports it.
        }
    }

    private handleLine(line: string): void {
        if (line.trim() === '') {
            return;
        }
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            return;
        }
        const out = this.reducer.handle(frame);
        this.apply(out);
        if (this.isTurnEnd(frame)) {
            this.options.persist();
        }
    }

    private isTurnEnd(frame: unknown): boolean {
        return typeof frame === 'object' && frame !== null && (frame as { type?: unknown }).type === 'result';
    }

    private apply(out: ReducerOutput): void {
        for (const action of out.actions) {
            this.pending.set(action.requestId, { toolUseId: action.toolUseId });
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

    private closeStdin(): void {
        if (this.stdinClosed || !this.process) {
            return;
        }
        this.stdinClosed = true;
        try {
            this.process.stdin.end();
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
