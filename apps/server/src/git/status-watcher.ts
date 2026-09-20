import { join, resolve, sep } from 'node:path';
import type { GitStatus } from '@ruimte/contracts';
import { PerClientWatches, settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '../fs/watch-seam.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { ignoredPaths } from './ignore.ts';
import { git } from './run.ts';
import { readStatus, trackedFiles } from './status.ts';
import { ClientSinks } from '../client-sinks.ts';

// A save, a formatter and a checkout all touch the repository in a burst; one status per burst is enough.
const SETTLE_MS = 300;
// A status run past this makes a live watch cost more than it is worth on this repository.
const SLOW_STATUS_MS = 1000;
// And so does a repository this big, before the first run even proves it.
const MAX_TRACKED_FILES = 5000;

/* Loose objects and lock files move on every git command and say nothing about the status. */
const isNoise = (path: string): boolean => path.includes(`${sep}objects${sep}`) || path.endsWith('.lock') || path.endsWith('~');

interface Watch {
    cwd: string;
    root: string;
    watchers: DirectoryWatcher[];
    /* The paths that moved since the last flush, absolute. */
    touched: Set<string>;
    settle: Settled;
    /* What was last published, so an unchanged status is not sent again. */
    fingerprint: string | null;
    running: boolean;
    /* Something moved while a status was running, so another one follows it. */
    again: boolean;
}

/*
 * Watches the working tree and git directory while a client needs live status. Large repositories
 * or slow status runs degrade to `live: false`, letting the client refresh only when needed.
 */
export class GitStatusWatcher {
    private readonly sinks = new ClientSinks();
    private readonly watches = new PerClientWatches<Watch>((state) => GitStatusWatcher.stop(state));
    /* Repository roots that proved too expensive to watch; they stay that way for this run. */
    private readonly degraded = new Set<string>();
    private readonly platform: NodeJS.Platform;
    private readonly seams: WatchSeams;
    private readonly now: () => number;

    constructor(platform: NodeJS.Platform = process.platform, seams: WatchSeams = SYSTEM_WATCH, now: () => number = Date.now) {
        this.platform = platform;
        this.seams = seams;
        this.now = now;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The status of a checkout, with the flag that says whether it keeps itself up to date. */
    async status(cwd: string): Promise<GitStatus> {
        const status = await readStatus(cwd);
        return { ...status, live: status.root !== null && !this.degraded.has(status.root) };
    }

    async watch(clientId: string, cwd: string): Promise<void> {
        const key = resolve(cwd);
        if (this.watches.get(clientId, key) !== undefined) {
            return;
        }
        const root = (await git(['rev-parse', '--show-toplevel'], key))?.trim();
        if (!root) {
            return;
        }
        const state: Watch = {
            cwd: key,
            root,
            watchers: [],
            touched: new Set(),
            settle: settled(this.seams, SETTLE_MS, () => this.flush(clientId, state)),
            fingerprint: null,
            running: false,
            again: false
        };
        this.watches.put(clientId, key, state);
        if ((await trackedFiles(root)) > MAX_TRACKED_FILES) {
            this.degraded.add(root);
            return;
        }
        // A linked worktree keeps its refs in the repository it came from, where a commit on another
        // branch is what makes this one's ahead and behind move.
        const common = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root))?.trim();
        for (const dir of common && !common.startsWith(root + sep) ? [root, common] : [root]) {
            this.attach(state, dir);
        }
    }

    unwatch(clientId: string, cwd: string): void {
        this.watches.remove(clientId, resolve(cwd));
    }

    detachAll(clientId: string): void {
        this.watches.detachAll(clientId);
    }

    private attach(state: Watch, dir: string): void {
        let watcher: DirectoryWatcher;
        try {
            watcher = this.seams.watch(dir, { recursive: supportsRecursive(this.platform) }, (_event, filename) => {
                const name = typeof filename === 'string' ? filename : null;
                // A platform that reports no name could have touched anything under the directory.
                state.touched.add(name === null ? dir : join(dir, name));
                state.settle.nudge();
            });
        } catch {
            // A directory that cannot be watched leaves the panel on its refresh button.
            return;
        }
        watcher.on('error', () => undefined);
        state.watchers.push(watcher);
    }

    private async flush(clientId: string, state: Watch): Promise<void> {
        const touched = [...state.touched];
        state.touched.clear();
        if (touched.length === 0 || !(await this.matters(state, touched))) {
            return;
        }
        if (state.running) {
            state.again = true;
            return;
        }
        state.running = true;
        const started = this.now();
        try {
            const status = await this.status(state.cwd);
            if (this.now() - started > SLOW_STATUS_MS) {
                this.degraded.add(state.root);
                GitStatusWatcher.stop(state);
                status.live = false;
            }
            const fingerprint = JSON.stringify(status);
            if (fingerprint !== state.fingerprint) {
                state.fingerprint = fingerprint;
                this.sinks.to(clientId, { event: 'git.status', payload: { cwd: state.cwd, status } });
            }
            // A diff reads the bytes, not the status, so it is told about a burst the status slept through.
            this.sinks.to(clientId, { event: 'git.changed', payload: { cwd: state.cwd } });
        } finally {
            state.running = false;
        }
        if (state.again) {
            state.again = false;
            await this.flush(clientId, state);
        }
    }

    /* Whether a burst is worth a status run: a build writing into an ignored folder is not. */
    private async matters(state: Watch, touched: string[]): Promise<boolean> {
        const paths = touched.filter((path) => !isNoise(path));
        if (paths.length === 0) {
            return false;
        }
        const outside = paths.filter((path) => !path.startsWith(state.root + sep));
        if (outside.length > 0) {
            return true;
        }
        const ignored = await ignoredPaths(paths, state.root);
        return paths.some((path) => !ignored.has(path));
    }

    private static stop(state: Watch): void {
        state.settle.stop();
        for (const watcher of state.watchers) {
            watcher.close();
        }
        state.watchers.length = 0;
    }
}
