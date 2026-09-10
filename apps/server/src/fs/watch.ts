import { watch, type FSWatcher } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { SessionSink } from '../sessions/manager.ts';
import { forgetSearchCache } from './search.ts';

// A save, a formatter and a build all touch the same folder in a burst; one event per burst is enough.
const SETTLE_MS = 250;

// Recursive watching is one call to the platform on macOS and Windows. Elsewhere it costs a
// descriptor per directory in the tree, so a watch there covers only the directory it names and the
// client watches the folders it has open.
const supportsRecursive = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'win32';

const isUnder = (path: string, ancestor: string): boolean => path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);

interface Watch {
    root: string;
    recursive: boolean;
    watcher: FSWatcher;
    // The directories that changed since the last flush, absolute.
    touched: Set<string>;
    settle: ReturnType<typeof setTimeout> | null;
}

/*
 * Folders a client is looking at, watched for as long as it looks. Every batch is one `fs.changed`
 * naming the directories that moved, so the client re-lists only what it has loaded. A watch is per
 * client, like a session attach: two windows on the same folder each get their own.
 */
export class FolderWatcher {
    private readonly sinks = new Map<string, SessionSink>();
    private readonly byClient = new Map<string, Map<string, Watch>>();
    private readonly platform: NodeJS.Platform;

    constructor(platform: NodeJS.Platform = process.platform) {
        this.platform = platform;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    watch(clientId: string, path: string): void {
        const root = resolve(path);
        const watches = this.byClient.get(clientId) ?? new Map<string, Watch>();
        this.byClient.set(clientId, watches);
        for (const existing of watches.values()) {
            // A recursive watch above it already reports everything this one would.
            if (existing.recursive && isUnder(root, existing.root)) {
                return;
            }
        }
        const recursive = supportsRecursive(this.platform);
        let watcher: FSWatcher;
        try {
            watcher = watch(root, { recursive });
        } catch {
            // A folder that cannot be watched still lists; the tree just goes stale until a refresh.
            return;
        }
        const state: Watch = { root, recursive, watcher, touched: new Set(), settle: null };
        watcher.on('error', () => undefined);
        watcher.on('change', (_event, filename) => {
            const name = typeof filename === 'string' ? filename : null;
            // A platform that reports no name could have touched anything under the root.
            state.touched.add(name === null ? root : dirname(join(root, name)));
            if (state.settle) {
                clearTimeout(state.settle);
            }
            state.settle = setTimeout(() => this.flush(clientId, state), SETTLE_MS);
        });
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
        state.settle = null;
        const paths = [...state.touched].sort();
        state.touched.clear();
        if (paths.length === 0) {
            return;
        }
        // The `@` picker reads the same folder from a cache of its own; a write there is stale news.
        forgetSearchCache();
        this.sinks.get(clientId)?.({ event: 'fs.changed', payload: { root: state.root, paths } });
    }

    private static stop(state: Watch): void {
        if (state.settle) {
            clearTimeout(state.settle);
        }
        state.watcher.close();
    }
}
