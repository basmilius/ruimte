import { dirname, join, resolve } from 'node:path';
import { PerClientWatches, settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { isUnder } from './path-segment.ts';

// A save, a formatter and a build all touch the same folder in a burst; one event per burst is enough.
const SETTLE_MS = 250;

// FSEvents can miss writes immediately after `fs.watch`; delay readiness until its stream is running.
const STREAM_START_MS = 200;

interface Watch {
    root: string;
    recursive: boolean;
    watcher: DirectoryWatcher;
    ready: Promise<void>;
    replacement?: Watch;
    // The directories that changed since the last flush, absolute.
    touched: Set<string>;
    changedPaths: Set<string> | null;
    settle: Settled;
}

/*
 * Folders a client is looking at, watched for as long as it looks. Every batch is one `fs.changed`
 * naming the directories that moved, so the client re-lists only what it has loaded.
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
            // Covered paths share the stream's startup barrier.
            if (existing.root === root || (existing.recursive && isUnder(root, existing.root))) {
                return existing.ready;
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

                if (name === null) {
                    state.changedPaths = null;
                } else {
                    state.changedPaths?.add(join(root, name));
                }

                state.settle.nudge();
            });
        } catch {
            // A folder that cannot be watched still lists; the tree just goes stale until a refresh.
            return Promise.resolve();
        }
        const starting = this.platform === 'darwin' && this.streamStartMs > 0;
        const ready = starting
            ? new Promise<void>((resolve) => {
                  this.seams.schedule(resolve, this.streamStartMs);
              })
            : Promise.resolve();
        const state: Watch = {
            root,
            recursive,
            watcher,
            ready,
            touched: new Set(),
            changedPaths: new Set(),
            settle: settled(this.seams, SETTLE_MS, () => this.flush(clientId, state))
        };
        watcher.on('error', () => undefined);
        this.watches.put(clientId, root, state);
        state.ready = ready.then(() => state.replacement?.ready);
        if (recursive) {
            this.coverDescendants(clientId, state);
        }
        return state.ready;
    }

    unwatch(clientId: string, path: string): void {
        this.watches.remove(clientId, resolve(path));
    }

    detachAll(clientId: string): void {
        this.watches.detachAll(clientId);
    }

    private coverDescendants(clientId: string, state: Watch): void {
        if (this.watches.get(clientId, state.root) !== state) {
            return;
        }
        for (const [key, existing] of this.watches.all(clientId)) {
            if (existing !== state && isUnder(existing.root, state.root)) {
                // Pending readers follow the new stream, and queued changes survive closing the old handle.
                existing.replacement = state;
                for (const path of existing.touched) {
                    state.touched.add(path);
                }
                if (existing.changedPaths === null) {
                    state.changedPaths = null;
                } else {
                    for (const path of existing.changedPaths) {
                        state.changedPaths?.add(path);
                    }
                }

                if (existing.touched.size > 0) {
                    state.settle.nudge();
                }
                this.watches.remove(clientId, key);
            }
        }
    }

    private flush(clientId: string, state: Watch): void {
        const paths = [...state.touched].sort();
        const changedPaths = state.changedPaths === null ? undefined : [...state.changedPaths].sort();
        state.touched.clear();
        state.changedPaths = new Set();

        if (paths.length === 0) {
            return;
        }
        this.sinks.to(clientId, { event: 'fs.changed', payload: { root: state.root, paths, ...(changedPaths === undefined ? {} : { changedPaths }) } });
    }
}
