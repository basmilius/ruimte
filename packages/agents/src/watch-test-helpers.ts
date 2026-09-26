import type { DirectoryWatcher, WatchDirectory, WatchSeams } from './watch-seam.ts';

export class FakeDirectoryWatcher implements DirectoryWatcher {
    readonly path: string;
    readonly recursive: boolean;
    closed = false;
    private readonly listener: (event: string, filename: string | null) => void;

    constructor(path: string, recursive: boolean, listener: (event: string, filename: string | null) => void) {
        this.path = path;
        this.recursive = recursive;
        this.listener = listener;
    }

    /* What the platform would report for a write to `filename`, relative to the watched directory. */
    emit(filename: string | null): void {
        if (this.closed) {
            return;
        }
        this.listener('change', filename);
    }

    on(): this {
        return this;
    }

    close(): void {
        this.closed = true;
    }
}

/*
 * A watch function and a settle timer that only move when a test says so: `emit` on a watcher stands
 * in for the platform, and `settle` runs every timer that is due and waits for the work it started.
 */
export class FakeWatch implements WatchSeams {
    readonly watchers: FakeDirectoryWatcher[] = [];
    private readonly due = new Map<number, () => unknown>();
    private nextId = 1;

    readonly watch: WatchDirectory = (path, options, listener) => {
        const watcher = new FakeDirectoryWatcher(path, options.recursive, listener);
        this.watchers.push(watcher);
        return watcher;
    };

    readonly schedule = (callback: () => unknown, _ms: number): (() => void) => {
        const id = this.nextId++;
        this.due.set(id, callback);
        return () => {
            this.due.delete(id);
        };
    };

    /* How many timers are waiting to run. */
    get pending(): number {
        return this.due.size;
    }

    openOn(path: string): FakeDirectoryWatcher[] {
        return this.watchers.filter((watcher) => watcher.path === path && !watcher.closed);
    }

    /* The one open watcher on `path`, which a test that emits on it expects to exist. */
    on(path: string): FakeDirectoryWatcher {
        const [watcher, ...rest] = this.openOn(path);
        if (!watcher || rest.length > 0) {
            throw new Error(`Expected one open watcher on ${path}, found ${rest.length + (watcher ? 1 : 0)}`);
        }
        return watcher;
    }

    async settle(): Promise<void> {
        const callbacks = [...this.due.values()];
        this.due.clear();
        await Promise.all(callbacks.map((callback) => callback()));
    }
}

/* A sink's events, with a promise for the moment one of them passes a check, so a test awaits the event itself rather than a deadline. */
export class EventLog<T> {
    readonly events: T[] = [];
    private waiters: Array<{ check: (events: T[]) => boolean; resolve: () => void }> = [];

    readonly push = (event: T): void => {
        this.events.push(event);
        const ready = this.waiters.filter((waiter) => waiter.check(this.events));
        this.waiters = this.waiters.filter((waiter) => !ready.includes(waiter));
        for (const waiter of ready) {
            waiter.resolve();
        }
    };

    until(check: (events: T[]) => boolean): Promise<void> {
        if (check(this.events)) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push({ check, resolve });
        });
    }
}
