import { dirname, join, resolve, sep } from 'node:path';
import type { SessionSink } from '../sessions/manager.ts';
import { forgetSearchCache } from './search.ts';
import { SYSTEM_WATCH, type DirectoryWatcher, type WatchSeams } from './watch-seam.ts';
import { ClientSinks } from '../client-sinks.ts';

// A save, a formatter and a build all touch the same folder in a burst; one event per burst is enough.
const SETTLE_MS = 250;

// Recursive watching costs one descriptor per directory outside macOS and Windows.
const supportsRecursive = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'win32';

// FSEvents can miss writes immediately after `fs.watch`; delay readiness until its stream is running.
const STREAM_START_MS = 200;

const isUnder = (path: string, ancestor: string): boolean => path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);

interface Watch {
    root: string;
    recursive: boolean;
    watcher: DirectoryWatcher;
    // The directories that changed since the last flush, absolute.
    touched: Set<string>;
    cancelSettle: (() => void) | null;
}

/*
 * Folders a client is looking at, watched for as long as it looks. Every batch is one `fs.changed`
 * naming the directories that moved, so the client re-lists only what it has loaded. A watch is per
 * client, like a session attach: two windows on the same folder each get their own.
 */
export class FolderWatcher {
    private readonly sinks = new ClientSinks();
    private readonly byClient = new Map<string, Map<string, Watch>>();
    private readonly platform: NodeJS.Platform;
    private readonly seams: WatchSeams;
    private readonly streamStartMs: number;

    constructor(platform: NodeJS.Platform = process.platform, seams: WatchSeams = SYSTEM_WATCH, streamStartMs: number = STREAM_START_MS) {
        this.platform = platform;
        this.seams = seams;
        this.streamStartMs = streamStartMs;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Starts watching at once; the promise settles when a write is sure to be reported. */
    watch(clientId: string, path: string): Promise<void> {
        const root = resolve(path);
        const watches = this.byClient.get(clientId) ?? new Map<string, Watch>();
        this.byClient.set(clientId, watches);
        for (const existing of watches.values()) {
            // A recursive watch above it already reports everything this one would.
            if (existing.recursive && isUnder(root, existing.root)) {
                return Promise.resolve();
            }
        }
        const recursive = supportsRecursive(this.platform);
        let watcher: DirectoryWatcher;
        try {
            // The platform reports a change only after this call returned, so `state` is there by then.
            watcher = this.seams.watch(root, { recursive }, (_event, filename) => {
                const name = typeof filename === 'string' ? filename : null;
                // A platform that reports no name could have touched anything under the root.
                state.touched.add(name === null ? root : dirname(join(root, name)));
                state.cancelSettle?.();
                state.cancelSettle = this.seams.schedule(() => this.flush(clientId, state), SETTLE_MS);
            });
        } catch {
            // A folder that cannot be watched still lists; the tree just goes stale until a refresh.
            return Promise.resolve();
        }
        const state: Watch = { root, recursive, watcher, touched: new Set(), cancelSettle: null };
        watcher.on('error', () => undefined);
        if (recursive) {
            // The new watch covers them, and two watchers over one directory would report twice.
            for (const [key, existing] of watches) {
                if (isUnder(existing.root, root)) {
                    FolderWatcher.stop(existing);
                    watches.delete(key);
                }
            }
        }
        watches.set(root, state);
        return this.platform === 'darwin' && this.streamStartMs > 0 ? Bun.sleep(this.streamStartMs) : Promise.resolve();
    }

    unwatch(clientId: string, path: string): void {
        const watches = this.byClient.get(clientId);
        const root = resolve(path);
        const state = watches?.get(root);
        if (!watches || !state) {
            return;
        }
        FolderWatcher.stop(state);
        watches.delete(root);
        if (watches.size === 0) {
            this.byClient.delete(clientId);
        }
    }

    detachAll(clientId: string): void {
        for (const state of this.byClient.get(clientId)?.values() ?? []) {
            FolderWatcher.stop(state);
        }
        this.byClient.delete(clientId);
    }

    private flush(clientId: string, state: Watch): void {
        state.cancelSettle = null;
        const paths = [...state.touched].sort();
        state.touched.clear();
        if (paths.length === 0) {
            return;
        }
        // The `@` picker reads the same folder from a cache of its own; a write there is stale news.
        forgetSearchCache();
        this.sinks.to(clientId, { event: 'fs.changed', payload: { root: state.root, paths } });
    }

    private static stop(state: Watch): void {
        state.cancelSettle?.();
        state.watcher.close();
    }
}
