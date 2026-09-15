/*
 * The part of a child process a chat backend talks to: lines in over stdin, lines out over stdout,
 * a signal and an exit. A test hands in a CLI that runs in the same process instead of a real one.
 */
export interface ChatProcess {
    readonly pid: number;
    readonly stdin: {
        write(chunk: string): unknown;
        flush(): unknown;
        end(): unknown;
    };
    readonly stdout: ReadableStream<Uint8Array>;
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ChatSpawnOptions {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    onExit(exitCode: number | null): void;
}

export type SpawnChatProcess = (options: ChatSpawnOptions) => ChatProcess;

export const spawnChatProcess: SpawnChatProcess = (options) =>
    Bun.spawn(options.command, {
        cwd: options.cwd,
        env: options.env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        onExit: (_subprocess, exitCode) => options.onExit(exitCode)
    });
