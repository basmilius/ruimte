/** What ending a PTY's process needs of it, apart from the PTY, so the Windows branch runs in a test anywhere. */
export interface PtyKillTarget {
    readonly pid: number;
    hasExited(): boolean;
    write(data: string): void;
    signal(signal: NodeJS.Signals): void;
}

/** Starts a command and leaves it running; `exited` settles when it ends. */
export type KillSpawner = (argv: string[]) => { readonly exited: Promise<unknown> };

export interface PtyKill {
    kill(signal: NodeJS.Signals): void;
    /* Settles once the taskkill still running, and the SIGKILL after it, are done; at once when none runs. */
    settled(): Promise<void>;
}

export interface PtyKillOptions {
    platform?: string;
    spawn?: KillSpawner;
}

// A taskkill that hangs would hold every later kill back, the SIGKILL after it included.
const TASKKILL_LIMIT_MS = 5_000;

function spawnUnawaited(argv: string[]): { readonly exited: Promise<unknown> } {
    return Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', timeout: TASKKILL_LIMIT_MS });
}

/*
 * Windows has no signals, and Bun terminates the process for any it accepts (SIGHUP it refuses). An
 * interrupt is the Ctrl+C the console turns into its own event; anything else takes the whole tree,
 * since an agent the shell started is no child the console would end with it. taskkill runs without
 * being awaited, since a daemon ending every terminal at once would otherwise stall every client for
 * the sum of those runs, and the escalation to SIGKILL that follows a SIGHUP starts no second one
 * while the first still runs.
 */
export function createPtyKill(target: PtyKillTarget, options: PtyKillOptions = {}): PtyKill {
    const platform = options.platform ?? process.platform;
    const spawn = options.spawn ?? spawnUnawaited;
    let taskkill: Promise<void> | null = null;

    const forceKill = (): void => {
        if (target.hasExited()) {
            return;
        }
        try {
            target.signal('SIGKILL');
        } catch {
            // taskkill already ended it.
        }
    };

    const kill = (signal: NodeJS.Signals): void => {
        if (target.hasExited()) {
            return;
        }
        if (platform !== 'win32') {
            target.signal(signal);
            return;
        }
        if (signal === 'SIGINT') {
            target.write('\x03');
            return;
        }
        if (taskkill !== null) {
            return;
        }
        let exited: Promise<unknown>;
        try {
            exited = spawn(['taskkill', '/PID', String(target.pid), '/T', '/F']).exited;
        } catch {
            forceKill();
            return;
        }
        const settle = (): void => {
            taskkill = null;
            forceKill();
        };
        taskkill = exited.then(settle, settle);
    };

    return {
        kill,
        settled: () => taskkill ?? Promise.resolve()
    };
}
