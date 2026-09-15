import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * A daemon under the background service that finds a newer binary on disk ends itself once nothing
 * is running, and launchd's KeepAlive (or systemd's Restart=always) starts the new one. Without it an
 * update leaves the old daemon running until someone opens the app, which may be never.
 */

export type SelfUpdateVerdict =
    /* Not under the service, or a build without an id (a checkout, the dev app): never exits on its own. */
    | 'off'
    | 'current'
    /* No id beside the binary, as in the middle of an update that is replacing the bundle. */
    | 'unreadable'
    | 'busy'
    | 'update';

export interface SelfUpdateFacts {
    underService: boolean;
    running: string | null;
    onDisk: string | null;
    idle(): boolean;
}

export const selfUpdateVerdict = (facts: SelfUpdateFacts): SelfUpdateVerdict => {
    if (!facts.underService || facts.running === null) {
        return 'off';
    }
    if (facts.onDisk === null) {
        return 'unreadable';
    }
    if (facts.onDisk === facts.running) {
        return 'current';
    }
    // Only asked once the build differs, since reading the process table is the one step that costs anything.
    return facts.idle() ? 'update' : 'busy';
};

/* Where `scripts/compile.ts` writes the id, beside the binary, so the new id is read without running the new binary. */
export const buildFileOf = (executable: string): string => join(dirname(executable), 'ruimte.build');

export const readBuildFile = (path: string, read: (path: string) => string = (file) => readFileSync(file, 'utf8')): string | null => {
    try {
        return read(path).trim() || null;
    } catch {
        return null;
    }
};

export interface SelfUpdateTimers {
    every(ms: number, run: () => void): () => void;
    after(ms: number, run: () => void): () => void;
}

export interface SelfUpdaterOptions {
    underService: boolean;
    running: string | null;
    readOnDisk(): string | null;
    idle(): boolean;
    /* Flushes like a SIGTERM and exits, so the service manager starts the binary that is on disk now. */
    exit(): void;
    log(line: string): void;
    timers?: SelfUpdateTimers;
    intervalMs?: number;
    nudgeDelayMs?: number;
}

// Reading a few bytes a minute costs nothing, and an update is rarely in a hurry.
const INTERVAL_MS = 60_000;
// A shell that just exited or a turn that just ended leaves its processes a moment to go.
const NUDGE_DELAY_MS = 3_000;

const realTimers: SelfUpdateTimers = {
    every(ms, run) {
        const timer = setInterval(run, ms);
        timer.unref?.();
        return () => clearInterval(timer);
    },
    after(ms, run) {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
    }
};

const LOG_LINES: Record<Exclude<SelfUpdateVerdict, 'off' | 'current'>, string> = {
    unreadable: 'A build id beside the binary cannot be read; waiting before updating',
    busy: 'A newer build is on disk; updating once no terminal or agent is running',
    update: 'A newer build is on disk and nothing is running; exiting so the service starts it'
};

export class SelfUpdater {
    private readonly options: SelfUpdaterOptions;
    private readonly timers: SelfUpdateTimers;
    private stopInterval: (() => void) | null = null;
    private cancelNudge: (() => void) | null = null;
    private lastVerdict: SelfUpdateVerdict | null = null;
    private exiting = false;

    constructor(options: SelfUpdaterOptions) {
        this.options = options;
        this.timers = options.timers ?? realTimers;
    }

    /* Only a daemon the service runs checks at all; any other has nobody to start it again. */
    start(): void {
        if (!this.options.underService || this.options.running === null || this.stopInterval !== null) {
            return;
        }
        this.stopInterval = this.timers.every(this.options.intervalMs ?? INTERVAL_MS, () => this.check());
    }

    stop(): void {
        this.stopInterval?.();
        this.stopInterval = null;
        this.cancelNudge?.();
        this.cancelNudge = null;
    }

    /* Something that may have ended the last work happened: a check shortly, rather than at the next tick. */
    nudge(): void {
        if (this.stopInterval === null || this.cancelNudge !== null) {
            return;
        }
        this.cancelNudge = this.timers.after(this.options.nudgeDelayMs ?? NUDGE_DELAY_MS, () => {
            this.cancelNudge = null;
            this.check();
        });
    }

    check(): SelfUpdateVerdict {
        const verdict = selfUpdateVerdict({
            underService: this.options.underService,
            running: this.options.running,
            onDisk: this.options.readOnDisk(),
            idle: this.options.idle
        });
        // Logged when it changes, so a machine that stays busy for a day writes one line and not 1440.
        if (verdict !== this.lastVerdict && verdict !== 'off' && verdict !== 'current') {
            this.options.log(LOG_LINES[verdict]);
        }
        this.lastVerdict = verdict;
        if (verdict === 'update' && !this.exiting) {
            this.exiting = true;
            this.stop();
            this.options.exit();
        }
        return verdict;
    }
}
