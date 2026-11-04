import { dirname, join, relative, resolve } from 'node:path';
import { settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { isWithin } from '@adecore/utils/path';
import { forgetRepos } from '../git/repo-cache.ts';
import { forgetSearchCache } from './search.ts';

// Long enough to take an install or a checkout as one burst, short enough that a list read after it is fresh.
const FORGET_SETTLE_MS = 250;

type Listener = (event: string, filename: string | null) => void;

interface Subscriber {
    path: string;
    listener: Listener;
}

interface PlatformWatch {
    path: string;
    recursive: boolean;
    handle: DirectoryWatcher;
    subscribers: Set<Subscriber>;
}

/* The `@` picker and the repository list read folders from caches of their own; a write there is stale news. */
function forgetCaches(paths: readonly string[]): void {
    forgetSearchCache(paths);
    forgetRepos(paths);
}

interface SharedWatchOptions {
    platform?: NodeJS.Platform;
    seams?: WatchSeams;
    /* Told the directories every burst touched, whoever watched them. */
    forget?: (paths: readonly string[]) => void;
}

/*
 * The watch seam every watcher of the daemon goes through: the file tree, git status and the language
 * servers each ask for the folders they need, and this opens one platform watcher per folder for all of
 * them. Where the platform watches a tree in one call, a folder under one already watched rides on that
 * one. Every burst it hears also drops what the daemon's caches hold of the directories it touched.
 */
export class SharedWatch implements WatchSeams {
    private readonly watches: PlatformWatch[] = [];
    private readonly seams: WatchSeams;
    private readonly treeWatch: boolean;
    private readonly forget: (paths: readonly string[]) => void;
    private readonly touched = new Set<string>();
    private readonly forgetting: Settled;

    constructor(options: SharedWatchOptions = {}) {
        this.seams = options.seams ?? SYSTEM_WATCH;
        this.treeWatch = supportsRecursive(options.platform ?? process.platform);
        this.forget = options.forget ?? forgetCaches;
        this.forgetting = settled(this.seams, FORGET_SETTLE_MS, () => this.flush());
    }

    watch(path: string, options: { recursive: boolean }, listener: Listener): DirectoryWatcher {
        const target = resolve(path);
        const shared = this.find(target, options.recursive) ?? this.start(target, options.recursive);
        const subscriber: Subscriber = { path: target, listener };
        shared.subscribers.add(subscriber);
        let closed = false;
        const handle: DirectoryWatcher = {
            // The platform watcher swallows its own errors; nobody here acts on one.
            on: () => handle,
            close: () => {
                if (closed) {
                    return;
                }
                closed = true;
                shared.subscribers.delete(subscriber);
                if (shared.subscribers.size === 0) {
                    shared.handle.close();
                    this.watches.splice(this.watches.indexOf(shared), 1);
                }
            }
        };
        return handle;
    }

    schedule(callback: () => unknown, ms: number): () => void {
        return this.seams.schedule(callback, ms);
    }

    private find(path: string, recursive: boolean): PlatformWatch | undefined {
        const exact = this.watches.find((watch) => watch.path === path && watch.recursive === recursive);
        if (exact !== undefined || !recursive || !this.treeWatch) {
            return exact;
        }
        return this.watches.find((watch) => watch.recursive && isWithin(watch.path, path));
    }

    private start(path: string, recursive: boolean): PlatformWatch {
        // The platform reports a change only after this call returned, so `shared` is there by then.
        const handle = this.seams.watch(path, { recursive }, (event, filename) => this.heard(shared, event, filename));
        handle.on('error', () => undefined);
        const shared: PlatformWatch = { path, recursive, handle, subscribers: new Set() };
        this.watches.push(shared);
        return shared;
    }

    private heard(shared: PlatformWatch, event: string, filename: string | null): void {
        const changed = filename === null ? null : join(shared.path, filename);
        this.touched.add(changed === null ? shared.path : dirname(changed));
        this.forgetting.nudge();
        for (const subscriber of [...shared.subscribers]) {
            if (subscriber.path === shared.path || changed === null) {
                subscriber.listener(event, filename);
            } else if (changed !== subscriber.path && isWithin(subscriber.path, changed)) {
                subscriber.listener(event, relative(subscriber.path, changed));
            }
        }
    }

    private flush(): void {
        const paths = [...this.touched].sort();
        this.touched.clear();
        if (paths.length > 0) {
            this.forget(paths);
        }
    }
}
