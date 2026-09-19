import { dirname, join, resolve, sep } from 'node:path';
import type { SessionSink } from '../sessions/manager.ts';
import { forgetSearchCache } from './search.ts';
import { PerClientWatches, settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from './watch-seam.ts';
import { ClientSinks } from '../client-sinks.ts';

// A save, a formatter and a build all touch the same folder in a burst; one event per burst is enough.
const SETTLE_MS = 250;

// FSEvents can miss writes immediately after `fs.watch`; delay readiness until its stream is running.
const STREAM_START_MS = 200;

const isUnder = (path: string, ancestor: string): boolean => path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);

interface Watch {
    root: string;
    recursive: boolean;
    watcher: DirectoryWatcher;
    // The directories that changed since the last flush, absolute.
    touched: Set<string>;
    settle: Settled;
}

/*
 * Folders a client is looking at, watched for as long as it looks. Every batch is one `fs.changed`
 * naming the directories that moved, so the client re-lists only what it has loaded. A watch is per
 * client, like a session attach: two windows on the same folder each get their own.
 */
export class FolderWatcher {
    private readonly sinks = new ClientSinks();
    private readonly watches = new PerClientWatches<Watch>((state) => {
        state.settle.stop();
        state.watcher.close();
    });
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
        for (const [, existing] of this.watches.all(clientId)) {
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
                state.settle.nudge();
            });
        } catch {
            // A folder that cannot be watched still lists; the tree just goes stale until a refresh.
            return Promise.resolve();
        }
        const state: Watch = { root, recursive, watcher, touched: new Set(), settle: settled(this.seams, SETTLE_MS, () => this.flush(clientId, state)) };
        watcher.on('error', () => undefined);
        if (recursive) {
            // The new watch covers them, and two watchers over one directory would report twice.
            for (const [key, existing] of this.watches.all(clientId)) {
                if (isUnder(existing.root, root)) {
                    this.watches.remove(clientId, key);
                }
            }
        }
        this.watches.put(clientId, root, state);
        return this.platform === 'darwin' && this.streamStartMs > 0 ? Bun.sleep(this.streamStartMs) : Promise.resolve();
    }

    unwatch(clientId: string, path: string): void {
        this.watches.remove(clientId, resolve(path));
    }

    detachAll(clientId: string): void {
        this.watches.detachAll(clientId);
    }

    private flush(clientId: string, state: Watch): void {
        const paths = [...state.touched].sort();
        state.touched.clear();
        if (paths.length === 0) {
            return;
        }
        // The `@` picker reads the same folder from a cache of its own; a write there is stale news.
        forgetSearchCache();
        this.sinks.to(clientId, { event: 'fs.changed', payload: { root: state.root, paths } });
    }
}
