import { ChatChild, type SpawnChatProcess } from './chat-process.ts';

export type CodexFrame = Record<string, unknown>;

interface CodexTransportOptions {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    spawn?: SpawnChatProcess;
    // Notifications and server requests; responses to our own requests settle their promise instead.
    onFrame(frame: CodexFrame): void;
    // `stderr` is the tail of what the app-server wrote there, for an exit with an error code only.
    onExit(exitCode: number | null, stderr: string | null): void;
}

class CodexRpcError extends Error {
    readonly code: number | null;

    constructor(method: string, error: unknown) {
        const detail = typeof error === 'object' && error !== null ? (error as { message?: unknown; code?: unknown }) : {};
        super(`${method} failed: ${typeof detail.message === 'string' ? detail.message : JSON.stringify(error)}`);
        this.name = 'CodexRpcError';
        this.code = typeof detail.code === 'number' ? detail.code : null;
    }
}

type Settle = { resolve(value: unknown): void; reject(reason: Error): void; method: string };

/*
 * One `codex app-server` process and the JSON-RPC framing on its stdio: newline-delimited JSON,
 * a request carries an id and gets a result or an error back under the same id, a notification
 * has no id. The app-server also sends requests of its own (approvals), answered with `respond`.
 */
export class CodexTransport {
    private readonly child: ChatChild;
    private readonly options: CodexTransportOptions;
    private readonly pending = new Map<number, Settle>();
    private nextId = 1;
    private closed = false;

    constructor(options: CodexTransportOptions) {
        this.options = options;
        this.child = new ChatChild({
            command: options.command,
            cwd: options.cwd,
            env: options.env,
            ...(options.spawn ? { spawn: options.spawn } : {}),
            onExit: (exitCode, stderr) => this.handleExit(exitCode, stderr)
        });
        void this.readLines();
    }

    get pid(): number {
        return this.child.pid;
    }

    get alive(): boolean {
        return !this.closed;
    }

    request(method: string, params: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (this.closed) {
                reject(new Error(`${method} failed: Codex is not running`));
                return;
            }
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject, method });
            this.write({ id, method, params });
        });
    }

    notify(method: string, params: unknown): void {
        this.write({ method, params });
    }

    respond(id: number | string, result: unknown): void {
        this.write({ id, result });
    }

    respondError(id: number | string, code: number, message: string): void {
        this.write({ id, error: { code, message } });
    }

    /* Closes stdin; the app-server ends on its own once it has nothing more to say. */
    end(): void {
        try {
            this.child.process.stdin.end();
        } catch {
            // Already closed by the other side.
        }
    }

    kill(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
        this.child.process.kill(signal);
    }

    stop(): void {
        this.end();
        this.child.endAfterGrace();
    }

    dispose(): Promise<void> {
        return this.child.end();
    }

    private write(frame: CodexFrame): void {
        if (this.closed) {
            return;
        }
        try {
            this.child.process.stdin.write(`${JSON.stringify(frame)}\n`);
            this.child.process.stdin.flush();
        } catch {
            // The exit handler reports a process that is gone.
        }
    }

    private async readLines(): Promise<void> {
        const reader = this.child.process.stdout.getReader();
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
        if (this.closed || line.trim() === '') {
            return;
        }
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
            return;
        }
        const message = frame as CodexFrame;
        if (typeof message.method === 'string') {
            this.options.onFrame(message);
            return;
        }
        const settle = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
        if (!settle) {
            return;
        }
        this.pending.delete(message.id as number);
        if (message.error !== undefined) {
            settle.reject(new CodexRpcError(settle.method, message.error));
        } else {
            settle.resolve(message.result);
        }
    }

    private handleExit(exitCode: number | null, stderr: string | null): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const settle of this.pending.values()) {
            settle.reject(new Error(`${settle.method} failed: Codex exited`));
        }
        this.pending.clear();
        this.options.onExit(exitCode, stderr);
    }
}
