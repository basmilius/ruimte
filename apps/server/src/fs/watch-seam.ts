import { watch } from 'node:fs';

/* The part of an `fs.watch` handle the watchers use. */
export interface DirectoryWatcher {
    on(event: 'error', listener: (error: Error) => void): unknown;
    close(): void;
}

export type WatchDirectory = (path: string, options: { recursive: boolean }, listener: (event: string, filename: string | null) => void) => DirectoryWatcher;

/* Runs `callback` after `ms` and answers with the function that cancels it. */
export type Schedule = (callback: () => unknown, ms: number) => () => void;

/* What every watcher reaches the file system and the clock through, so a test can hand it fakes that it drives by hand. */
export interface WatchSeams {
    watch: WatchDirectory;
    schedule: Schedule;
}

/*
 * Recursive watching is one call to the platform on macOS and Windows; elsewhere it costs a
 * descriptor per directory, which a folder tree has too many of to be worth it.
 */
export const supportsRecursive = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'win32';

export const SYSTEM_WATCH: WatchSeams = {
    watch: (path, options, listener) => watch(path, options, listener),
    schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    }
};

/* One run after a burst of changes: every nudge puts it off again, and a stop drops the one waiting. */
export interface Settled {
    nudge(): void;
    stop(): void;
}

/*
 * A save, a formatter and a build all touch a folder in a burst, and one answer per burst is enough.
 * How long a burst is differs per watcher: reading one file again is cheap, a status run over a
 * whole repository is not.
 */
export const settled = (seams: WatchSeams, ms: number, run: () => unknown): Settled => {
    let cancel: (() => void) | null = null;
    return {
        nudge: () => {
            cancel?.();
            cancel = seams.schedule(() => {
                cancel = null;
                return run();
            }, ms);
        },
        stop: () => {
            cancel?.();
            cancel = null;
        }
    };
};

/*
 * What each client watches, keyed on the path it asked for. A watch is per client, like a session
 * attach: two windows on the same folder each get their own, and a socket that goes takes only its
 * own with it.
 */
export class PerClientWatches<TState> {
    private readonly byClient = new Map<string, Map<string, TState>>();
    private readonly stop: (state: TState) => void;

    constructor(stop: (state: TState) => void) {
        this.stop = stop;
    }

    get(clientId: string, key: string): TState | undefined {
        return this.byClient.get(clientId)?.get(key);
    }

    put(clientId: string, key: string, state: TState): void {
        const watches = this.byClient.get(clientId) ?? new Map<string, TState>();
        watches.set(key, state);
        this.byClient.set(clientId, watches);
    }

    /* Everything this client watches, as a copy, so a caller may close one while it walks them. */
    all(clientId: string): Array<[string, TState]> {
        return [...(this.byClient.get(clientId) ?? [])];
    }

    remove(clientId: string, key: string): void {
        const watches = this.byClient.get(clientId);
        const state = watches?.get(key);
        if (!watches || state === undefined) {
            return;
        }
        this.stop(state);
        watches.delete(key);
        if (watches.size === 0) {
            this.byClient.delete(clientId);
        }
    }

    detachAll(clientId: string): void {
        for (const state of this.byClient.get(clientId)?.values() ?? []) {
            this.stop(state);
        }
        this.byClient.delete(clientId);
    }
}
