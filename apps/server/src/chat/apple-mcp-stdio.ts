import { spawn, type ChildProcess } from 'node:child_process';
import { ReadBuffer, serializeMessage, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client';

export interface AppleStdioOptions {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
}

export class AppleStdioTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    private readonly options: AppleStdioOptions;
    private readonly buffer = new ReadBuffer({ maxBufferSize: 1024 * 1024 });
    private child: ChildProcess | null = null;
    private closing: Promise<void> | null = null;
    private closed = false;
    private started = false;
    private exited: Promise<void> = Promise.resolve();

    constructor(options: AppleStdioOptions) {
        this.options = options;
    }

    async start(): Promise<void> {
        if (this.started || this.closed) {
            throw new Error('This MCP transport has already started or closed.');
        }
        this.started = true;
        const child = spawn(this.options.command, this.options.args, {
            cwd: this.options.cwd,
            env: this.options.env,
            shell: false,
            detached: true,
            stdio: ['pipe', 'pipe', 'ignore']
        });
        this.child = child;
        let settleExit!: () => void;
        this.exited = new Promise((resolve) => {
            settleExit = resolve;
        });
        child.once('exit', () => {
            settleExit();
            void this.close();
        });
        child.on('error', (error) => {
            settleExit();
            this.onerror?.(error);
            void this.close();
        });
        child.stdin?.on('error', (error) => {
            if (!this.closed) {
                this.onerror?.(error);
                void this.close();
            }
        });
        child.stdout?.on('data', (chunk: Buffer) => {
            if (this.closed) {
                return;
            }
            try {
                this.buffer.append(chunk);
                while (!this.closed) {
                    const message = this.buffer.readMessage();
                    if (message === null) {
                        break;
                    }
                    this.onmessage?.(message);
                }
            } catch (error) {
                this.onerror?.(error instanceof Error ? error : new Error('Invalid MCP frame.'));
                void this.close();
            }
        });
        child.stdout?.on('error', (error) => {
            if (!this.closed) {
                this.onerror?.(error);
                void this.close();
            }
        });
        await new Promise<void>((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
        });
        if (this.closed) {
            this.killGroup('SIGKILL');
            throw new Error('The MCP transport closed while starting.');
        }
    }

    send(message: JSONRPCMessage): Promise<void> {
        if (this.closed || !this.child?.stdin) {
            return Promise.reject(new Error('The MCP transport is closed.'));
        }
        const encoded = serializeMessage(message);
        if (Buffer.byteLength(encoded) > 1024 * 1024) {
            return Promise.reject(new Error('The MCP request exceeds 1 MiB.'));
        }
        return new Promise((resolve, reject) => {
            this.child!.stdin!.write(encoded, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    close(): Promise<void> {
        if (this.closing) {
            return this.closing;
        }
        this.closed = true;
        this.closing = this.finishClose();
        return this.closing;
    }

    private async finishClose(): Promise<void> {
        const child = this.child;
        if (child) {
            child.stdin?.end();
            this.killGroup('SIGTERM');
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                this.exited,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, 250);
                })
            ]);
            clearTimeout(timer);
            // A descendant can keep running or holding pipes after its parent exits.
            this.killGroup('SIGKILL');
            child.stdin?.destroy();
            child.stdout?.destroy();
        }
        this.child = null;
        this.buffer.clear();
        this.onclose?.();
    }

    private killGroup(signal: 'SIGTERM' | 'SIGKILL'): void {
        if (this.child?.pid === undefined) {
            return;
        }
        try {
            process.kill(-this.child.pid, signal);
        } catch {
            // The entire process group may already have exited.
        }
    }
}
