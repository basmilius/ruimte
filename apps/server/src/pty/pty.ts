import { basename } from 'node:path';

export interface PtySpawnOptions {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
}

export interface PtyProcess {
    readonly pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: NodeJS.Signals): void;
    onData(callback: (data: Uint8Array) => void): void;
    onExit(callback: (exitCode: number) => void): void;
}

// The one seam between the session layer and the runtime that owns the PTY, so a test
// can feed a fake and a future runtime (a different spawn API, a remote host) slots in.
export interface PtyAdapter {
    spawn(options: PtySpawnOptions): PtyProcess;
}

export const defaultShell = (env: Record<string, string | undefined> = process.env, platform: string = process.platform): string => {
    const fromEnv = env.SHELL?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    return platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
};

// Shells that understand -l. A PTY already makes them interactive; the login flag is what
// makes them read the profile that sets PATH, which a daemon started from launchd or systemd lacks.
const LOGIN_CAPABLE = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh']);

export const defaultShellArgs = (shell: string): string[] => (LOGIN_CAPABLE.has(basename(shell)) ? ['-l'] : []);

export const signalExitCode = (signal: string, signals: Record<string, number>): number => 128 + (signals[signal] ?? 0);
