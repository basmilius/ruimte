/** What ending a PTY's process needs of it, apart from the PTY, so the Windows branch runs in a test anywhere. */
export interface PtyKillTarget {
    readonly pid: number;
    hasExited(): boolean;
    write(data: string): void;
    signal(signal: NodeJS.Signals): void;
}

/** Starts a command and leaves it running; `exited` settles when it ends. */
export type KillSpawner = (argv: string[]) => { readonly exited: Promise<unknown> };

export interface PtyKillOptions {
    platform?: string;
    spawn?: KillSpawner;
}

function spawnDetached(argv: string[]): { readonly exited: Promise<unknown> } {
    return Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
}

/*
 * Windows has no signals, and Bun terminates the process for any it accepts (SIGHUP it refuses). An
 * interrupt is the Ctrl+C the console turns into its own event; anything else takes the whole tree,
 * since an agent the shell started is no child the console would end with it. taskkill runs without
 * being awaited, since a daemon ending every terminal at once would otherwise stall every client for
 * the sum of those runs, and the escalation to SIGKILL that follows a SIGHUP starts no second one
 * while the first still runs.
 */
export function createPtyKill(target: PtyKillTarget, options: PtyKillOptions = {}): (signal: NodeJS.Signals) => void {
    const platform = options.platform ?? process.platform;
    const spawn = options.spawn ?? spawnDetached;
    let taskkillRunning = false;

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

    return (signal) => {
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
        if (taskkillRunning) {
            return;
        }
        let exited: Promise<unknown>;
        try {
            exited = spawn(['taskkill', '/PID', String(target.pid), '/T', '/F']).exited;
        } catch {
            forceKill();
            return;
        }
        taskkillRunning = true;
        const settle = (): void => {
            taskkillRunning = false;
            forceKill();
        };
        void exited.then(settle, settle);
    };
}
