import { chatPrompt } from '../context/context-note.ts';
import { claudeArgs, promptPrefix } from '../providers/claude.ts';
import type { ApprovalDecision, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { spawnChatProcess, type ChatProcess } from './chat-process.ts';
import { ClaudeProtocol } from './claude-protocol.ts';
import { buildUserMessage } from './input.ts';

// After stdin closed, a CLI that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

/*
 * One `claude -p` process on the stream-json protocol: flags from the selection and the modes,
 * frames in over stdout, frames out over stdin. The process stays alive between turns; the session
 * starts a new backend with `--resume` when it needs one, which is also how a changed model takes
 * effect. Linked context is a sentence in the system prompt, which the CLI takes on its flag.
 */
export class ClaudeBackend implements ChatBackend {
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly protocol = new ClaudeProtocol();
    private process: ChatProcess | null = null;
    private stdinClosed = false;
    private exitTimer: ReturnType<typeof setTimeout> | null = null;
    // The person asked to stop; the result frame that follows closes the turn as aborted.
    private interrupted = false;

    constructor(launch: BackendLaunch, host: BackendHost) {
        this.launch = launch;
        this.host = host;
    }

    get running(): boolean {
        return this.process !== null;
    }

    get pid(): number | null {
        return this.process?.pid ?? null;
    }

    start(): Promise<void> {
        if (this.process) {
            return Promise.resolve();
        }
        const { selection, runtimeMode, resume } = this.launch;
        const args = [...this.launch.command, ...claudeArgs({ selection, runtimeMode, resume })];
        args.push('--append-system-prompt', chatPrompt({ hasContext: this.launch.hasContext, depth: this.launch.depth }));
        this.stdinClosed = false;
        const spawn = this.launch.spawn ?? spawnChatProcess;
        const process: ChatProcess = spawn({
            command: args,
            cwd: this.launch.cwd,
            env: this.launch.env,
            onExit: (exitCode) => this.handleExit(process, exitCode)
        });
        this.process = process;
        void this.readLines(process);
        return Promise.resolve();
    }

    sendTurn(input: TurnInput): void {
        // The prefix is what the CLI must see first (ultrathink), then the note about the links, then what was typed.
        const prefix = `${promptPrefix(this.launch.selection)}${input.preamble === null ? '' : `${input.preamble}\n\n`}`;
        this.write(buildUserMessage({ text: input.text, attachments: input.attachments, prefix, skills: input.skills }));
    }

    /* Claude Code folds its context through a slash command, so the session sends it as a turn. */
    compact(): void {
        this.sendTurn({ text: '/compact', preamble: null, attachments: [], mentions: [], skills: [] });
    }

    interrupt(): void {
        this.interrupted = true;
        this.write({ type: 'control_request', request_id: `interrupt-${Date.now()}`, request: { subtype: 'interrupt' } });
    }

    respondApproval(requestId: string, decision: ApprovalDecision, message?: string): boolean {
        const frame = this.protocol.approvalResponse(requestId, decision, message);
        if (frame === null) {
            return false;
        }
        this.write(frame);
        return true;
    }

    respondQuestion(requestId: string, answers: Record<string, string>): boolean {
        const frame = this.protocol.questionResponse(requestId, answers);
        if (frame === null) {
            return false;
        }
        this.write(frame);
        return true;
    }

    stop(): void {
        const process = this.process;
        if (!process || this.exitTimer !== null) {
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
        for (const event of this.protocol.handle(frame)) {
            if (event.type === 'turn.done' && this.interrupted) {
                this.interrupted = false;
                this.host.onEvent({ ...event, state: 'aborted' });
                continue;
            }
            this.host.onEvent(event);
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
        if (!this.process || this.stdinClosed) {
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
        this.protocol.forgetPending();
        this.host.onEvent({ type: 'exit', exitCode });
    }
}
