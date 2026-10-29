import { join, resolve, sep } from 'node:path';
import type { GitStatus } from '@ruimte/contracts';
import { PerClientWatches, settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { ignoredPaths } from './ignore.ts';
import { nativePath } from './native-path.ts';
import { git, repositoryRoot } from './run.ts';
import { noRepository, readStatusAt, trackedFiles } from './status.ts';
import { ClientSinks } from '../client-sinks.ts';
import { isUnder } from '../fs/path-segment.ts';

// A save, a formatter and a checkout all touch the repository in a burst; one status per burst is enough.
const SETTLE_MS = 300;
// A status run past this makes a live watch cost more than it is worth on this repository.
const SLOW_STATUS_MS = 1000;
// And so does a repository this big, before the first run even proves it.
const MAX_TRACKED_FILES = 5000;
// What made a run slow (an install, a busy machine) passes, so a slow root gets another chance after this.
const DEGRADED_MS = 5 * 60 * 1000;

/* Loose objects and lock files move on every git command and say nothing about the status. */
function isNoise(path: string, root: string): boolean {
    const metadata = !isUnder(path, root) || isUnder(path, join(root, '.git'));

    return metadata && (path.includes(`${sep}objects${sep}`) || path.endsWith('.lock') || path.endsWith('~'));
}

/* One repository watched for every client that asked, in whichever folder of it each one asked. */
interface RootWatch {
    root: string;
    /* The working tree, and the common git directory when it lies outside it. */
    dirs: string[];
    watchers: DirectoryWatcher[];
    /* The paths that moved since the last flush, absolute. */
    touched: Set<string>;
    settle: Settled;
    /* What was last published, so an unchanged status is not sent again. */
    fingerprint: string | null;
    /* Per client, the folders it watches this repository by, which is what its events name. */
    clients: Map<string, Set<string>>;
}

interface Subscription {
    clientId: string;
    cwd: string;
    watch: RootWatch;
}

/* The run under way for a root and the one that follows it, which every caller who came meanwhile shares. */
interface Flight {
    current: Promise<GitStatus> | null;
    queued: Promise<GitStatus> | null;
}

/*
 * Watches the working tree and git directory of a repository while some client needs its live status,
 * and runs one status per root for all of them. Large repositories or slow status runs degrade to
 * `live: false`, letting the client refresh only when needed.
 */
export class GitStatusWatcher {
    private readonly sinks = new ClientSinks();
    private readonly watches = new PerClientWatches<Subscription>((subscription) => this.leave(subscription));
    private readonly roots = new Map<string, RootWatch>();
    private readonly flights = new Map<string, Flight>();
    /* Repository roots whose last run was too slow to watch, with the moment it was. */
    private readonly degraded = new Map<string, number>();
    /* Repository roots too big to watch, as last counted. */
    private readonly tooBig = new Set<string>();
    private readonly platform: NodeJS.Platform;
    private readonly seams: WatchSeams;
    private readonly now: () => number;
    private readonly read: (root: string) => Promise<GitStatus>;

    constructor(
        platform: NodeJS.Platform = process.platform,
        seams: WatchSeams = SYSTEM_WATCH,
        now: () => number = Date.now,
        read: (root: string) => Promise<GitStatus> = readStatusAt
    ) {
        this.platform = platform;
        this.seams = seams;
        this.now = now;
        this.read = read;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The status of a checkout, with the flag that says whether it keeps itself up to date. */
    async status(cwd: string): Promise<GitStatus> {
        const root = await repositoryRoot(cwd);
        return root === null ? { ...noRepository(), live: false } : await this.run(root);
    }

    async watch(clientId: string, cwd: string): Promise<void> {
        const key = resolve(cwd);
        if (this.watches.get(clientId, key) !== undefined) {
            return;
        }
        const root = await repositoryRoot(key);
        if (root === null) {
            return;
        }
        const watch = this.roots.get(root) ?? (await this.prepare(root));
        // Registered only once git answered, so a second watch asked meanwhile finds this one and opens nothing of its own.
        if (this.watches.get(clientId, key) !== undefined) {
            return;
        }
        const cwds = watch.clients.get(clientId) ?? new Set<string>();
        cwds.add(key);
        watch.clients.set(clientId, cwds);
        this.watches.put(clientId, key, { clientId, cwd: key, watch });
    }

    unwatch(clientId: string, cwd: string): void {
        this.watches.remove(clientId, resolve(cwd));
    }

    detachAll(clientId: string): void {
        this.watches.detachAll(clientId);
    }

    /* The watch of a root nobody watched yet, opened unless the root is too big or too slow for one. */
    private async prepare(root: string): Promise<RootWatch> {
        if ((await trackedFiles(root, this.now())) > MAX_TRACKED_FILES) {
            this.tooBig.add(root);
        } else {
            this.tooBig.delete(root);
        }
        // A linked worktree keeps its refs in the repository it came from, where a commit on another
        // branch is what makes this one's ahead and behind move.
        const printed = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root))?.trim();
        const common = printed ? nativePath(printed) : printed;
        const existing = this.roots.get(root);
        if (existing !== undefined) {
            return existing;
        }
        const watch: RootWatch = {
            root,
            dirs: common && !common.startsWith(root + sep) ? [root, common] : [root],
            watchers: [],
            touched: new Set(),
            settle: settled(this.seams, SETTLE_MS, () => this.flush(watch)),
            fingerprint: null,
            clients: new Map()
        };
        this.roots.set(root, watch);
        if (this.isLive(root)) {
            this.open(watch);
        }
        return watch;
    }

    private leave(subscription: Subscription): void {
        const { watch, clientId, cwd } = subscription;
        const cwds = watch.clients.get(clientId);
        cwds?.delete(cwd);
        if (cwds?.size === 0) {
            watch.clients.delete(clientId);
        }
        if (watch.clients.size === 0 && this.roots.get(watch.root) === watch) {
            GitStatusWatcher.stop(watch);
            this.roots.delete(watch.root);
        }
    }

    /*
     * A status of the root, shared: a caller who comes while one runs waits for the run after it,
     * which every caller who came meanwhile shares, so nobody gets a status read before they asked.
     */
    private run(root: string): Promise<GitStatus> {
        const flight = this.flights.get(root) ?? { current: null, queued: null };
        this.flights.set(root, flight);
        if (flight.queued !== null) {
            return flight.queued;
        }
        if (flight.current === null) {
            return this.start(root, flight);
        }
        const queued = flight.current
            .catch(() => undefined)
            .then(() => {
                flight.queued = null;
                return this.start(root, flight);
            });
        flight.queued = queued;
        return queued;
    }

    private start(root: string, flight: Flight): Promise<GitStatus> {
        const current = this.timed(root).finally(() => {
            flight.current = null;
            if (flight.queued === null && this.flights.get(root) === flight) {
                this.flights.delete(root);
            }
        });
        flight.current = current;
        return current;
    }

    /* Every run is timed: a slow one closes the watch of its root, a fast one opens it again. */
    private async timed(root: string): Promise<GitStatus> {
        const started = this.now();
        const read = await this.read(root);
        if (this.now() - started > SLOW_STATUS_MS) {
            this.degrade(root);
        } else {
            this.recover(root);
        }
        const status = { ...read, live: read.root !== null && this.isLive(root) };
        const watch = this.roots.get(root);
        const fingerprint = JSON.stringify(status);
        if (watch !== undefined && fingerprint !== watch.fingerprint) {
            watch.fingerprint = fingerprint;
            this.publish(watch, (cwd) => ({ event: 'git.status', payload: { cwd, status } }));
        }
        return status;
    }

    private publish(watch: RootWatch, frame: (cwd: string) => SessionEvent): void {
        for (const [clientId, cwds] of watch.clients) {
            for (const cwd of cwds) {
                this.sinks.to(clientId, frame(cwd));
            }
        }
    }

    private isLive(root: string): boolean {
        if (this.tooBig.has(root)) {
            return false;
        }
        const since = this.degraded.get(root);
        if (since === undefined) {
            return true;
        }
        if (this.now() - since < DEGRADED_MS) {
            return false;
        }
        this.degraded.delete(root);
        return true;
    }

    private degrade(root: string): void {
        this.degraded.set(root, this.now());
        const watch = this.roots.get(root);
        if (watch !== undefined) {
            GitStatusWatcher.stop(watch);
        }
    }

    private recover(root: string): void {
        this.degraded.delete(root);
        const watch = this.roots.get(root);
        if (watch !== undefined && watch.watchers.length === 0 && this.isLive(root)) {
            this.open(watch);
        }
    }

    private open(watch: RootWatch): void {
        for (const dir of watch.dirs) {
            this.attach(watch, dir);
        }
    }

    private attach(watch: RootWatch, dir: string): void {
        let watcher: DirectoryWatcher;
        try {
            watcher = this.seams.watch(dir, { recursive: supportsRecursive(this.platform) }, (_event, filename) => {
                const name = typeof filename === 'string' ? filename : null;
                // A platform that reports no name could have touched anything under the directory.
                watch.touched.add(name === null ? dir : join(dir, name));
                watch.settle.nudge();
            });
        } catch {
            // A directory that cannot be watched leaves the panel on its refresh button.
            return;
        }
        watcher.on('error', () => undefined);
        watch.watchers.push(watcher);
    }

    private async flush(watch: RootWatch): Promise<void> {
        const touched = [...watch.touched];
        watch.touched.clear();
        if (touched.length === 0 || !(await this.matters(watch, touched))) {
            return;
        }
        await this.run(watch.root);
        // A diff reads the bytes, not the status, so it is told about a burst the status slept through.
        const broad = touched.some((path) => path === watch.root || !isUnder(path, watch.root) || path.split(sep).includes('.git'));
        const hint = broad ? {} : { changedPaths: touched.sort() };
        this.publish(watch, (cwd) => ({ event: 'git.changed', payload: { cwd, ...hint } }));
    }

    /* Whether a burst is worth a status run: a build writing into an ignored folder is not. */
    private async matters(watch: RootWatch, touched: string[]): Promise<boolean> {
        const paths = touched.filter((path) => !isNoise(path, watch.root));
        if (paths.length === 0) {
            return false;
        }
        const outside = paths.filter((path) => !path.startsWith(watch.root + sep));
        if (outside.length > 0) {
            return true;
        }
        const ignored = await ignoredPaths(paths, watch.root);
        return paths.some((path) => !ignored.has(path));
    }

    private static stop(watch: RootWatch): void {
        watch.settle.stop();
        for (const watcher of watch.watchers) {
            watcher.close();
        }
        watch.watchers.length = 0;
    }
}
