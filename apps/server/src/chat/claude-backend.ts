import { chatPrompt } from '../context/context-note.ts';
import { claudeArgs, claudeEnv, promptPrefix } from '../providers/claude.ts';
import type { ApprovalDecision, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { ChatChild } from './chat-process.ts';
import { ClaudeProtocol } from './claude-protocol.ts';
import { buildUserMessage } from './input.ts';

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
    private child: ChatChild | null = null;
    private stdinClosed = false;
    // The person asked to stop; the result frame that follows closes the turn as aborted.
    private interrupted = false;

    constructor(launch: BackendLaunch, host: BackendHost) {
        this.launch = launch;
        this.host = host;
    }

    get running(): boolean {
        return this.child !== null;
    }

    get pid(): number | null {
        return this.child?.pid ?? null;
    }

    start(): Promise<void> {
        if (this.child) {
            return Promise.resolve();
        }
        const { selection, runtimeMode, resume } = this.launch;
        const args = [...this.launch.command, ...claudeArgs({ selection, runtimeMode, resume })];
        args.push(
            '--append-system-prompt',
            chatPrompt({ sources: this.launch.context, depth: this.launch.depth, standalone: this.launch.standalone, computer: this.launch.computer })
        );
        this.stdinClosed = false;
        const child: ChatChild = new ChatChild({
            command: args,
            cwd: this.launch.cwd,
            env: { ...this.launch.env, ...claudeEnv(selection) },
            ...(this.launch.spawn ? { spawn: this.launch.spawn } : {}),
            onExit: (exitCode, stderr) => this.handleExit(child, exitCode, stderr)
        });
        this.child = child;
        void this.readLines(child);
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

    stopTask(taskId: string): void {
        this.write(this.protocol.stopTaskRequest(taskId));
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
        this.closeStdin();
        this.child?.endAfterGrace();
    }

    dispose(): Promise<void> {
        const child = this.child;
        this.child = null;
        return child?.end() ?? Promise.resolve();
    }

    private async readLines(child: ChatChild): Promise<void> {
        const reader = child.process.stdout.getReader();
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
                    this.handleLine(child, buffered.slice(0, newline));
                    buffered = buffered.slice(newline + 1);
                    newline = buffered.indexOf('\n');
                }
            }
            if (buffered.trim() !== '') {
                this.handleLine(child, buffered);
            }
        } catch {
            // The process died mid-read; onExit reports it.
        }
    }

    private handleLine(child: ChatChild, line: string): void {
        if (this.child !== child || line.trim() === '') {
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
        const child = this.child;
        if (!child || this.stdinClosed) {
            return;
        }
        try {
            child.process.stdin.write(`${JSON.stringify(frame)}\n`);
            child.process.stdin.flush();
        } catch {
            // The exit handler reports a process that is gone.
        }
    }

    private closeStdin(): void {
        if (!this.child || this.stdinClosed) {
            return;
        }
        this.stdinClosed = true;
        try {
            this.child.process.stdin.end();
        } catch {
            // Already closed by the other side.
        }
    }

    private handleExit(child: ChatChild, exitCode: number | null, stderr: string | null): void {
        if (this.child !== child) {
            return;
        }
        this.child = null;
        this.protocol.forgetPending();
        this.host.onEvent({ type: 'exit', exitCode, ...(stderr === null ? {} : { stderr }) });
    }
}
