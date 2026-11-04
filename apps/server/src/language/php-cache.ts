import { randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { isBelow, isWithin } from '@adecore/utils/path';
import type { Reclaimed } from '../maintenance/maintenance.ts';
import { realTimers, type Timers } from '../timers.ts';
import type { PhpCache } from './host.ts';

export const PHP_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;

const SIGHTINGS_FORMAT = 1;
const SIGHTINGS_MIN_COUNT = 3;
const SIGHTINGS_MIN_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 2000;

/* One pass reads a folder of at most this many names and removes at most this many files, whatever the folder grew to. */
const MAX_ENTRIES = 5000;
const MAX_REMOVALS = 200;

const MANIFEST_NAME = /^owner-.+\.json$/;
const CACHE_FILE_NAME = /^[\w.-]+\.bin$/;
const TEMPORARY_NAME = /\.(tmp|partial)$/;

export type Probe = 'present' | 'missing' | 'unknown';

export interface CacheEntry {
    name: string;
    size: number;
    mtimeMs: number;
}

/* The owner manifest a PHP server of format 1 writes beside its caches. */
export interface CacheOwner {
    /* The name of the manifest file in the cache folder. */
    manifest: string;
    kind: 'project' | 'stubs';
    path: string;
    folder: string;
    files: string[];
    lastUsedMs: number;
}

/* A root seen missing: when it first was, when it last was, and how many passes saw it. */
export interface Sighting {
    firstMs: number;
    lastMs: number;
    count: number;
}

export type Sightings = Record<string, Sighting>;

export interface EvictionInput {
    entries: readonly CacheEntry[];
    owners: readonly CacheOwner[];
    /* A manifest of a format this version does not know, or one that could not be read: nothing is touched. */
    unreadableOwner: boolean;
    live: { folders: readonly string[]; stubsDirs: readonly string[]; anyProcess: boolean };
    knownFolders: readonly string[];
    /* By owner path; an owner without an entry reads as `unknown`. */
    probes: Readonly<Record<string, Probe>>;
    sightings: Sightings;
    stubsRoot: string;
    keptStubs: readonly string[];
    now: number;
    budget: number;
}

export type GroupReason = 'stubs' | 'vanished' | 'emptied' | 'abandoned' | 'budget';

/* The files that go together, and the manifest that goes last. */
export interface Group {
    reason: GroupReason;
    files: string[];
    manifest: string | null;
    bytes: number;
}

export interface EvictionPlan {
    remove: Group[];
    sightings: Sightings;
}

function stubsCommitOf(path: string, stubsRoot: string): string | null {
    if (!isBelow(stubsRoot, path)) {
        return null;
    }

    const [commit = ''] = relative(stubsRoot, path).split(sep);

    return commit.replace(/\.partial$/, '');
}

function isLive(owner: CacheOwner, live: EvictionInput['live']): boolean {
    if (owner.kind === 'stubs') {
        return live.stubsDirs.includes(owner.path);
    }

    return live.folders.some((folder) => folder === owner.folder || isWithin(folder, owner.path));
}

/* A missing checkout is never proof while a known project folder is, holds or lies inside it. */
function isKnown(path: string, knownFolders: readonly string[]): boolean {
    return knownFolders.some((folder) => isWithin(folder, path) || isWithin(path, folder));
}

/*
 * Decides which cache groups go and which missing roots to remember. It reads nothing from disk and has
 * no clock; the order is the order of the rules: stubs Ruimte pruned, checkouts that vanished, files
 * nobody finished writing, and then, only over budget, the least recently used.
 */
export function planEviction(input: EvictionInput): EvictionPlan {
    if (input.unreadableOwner) {
        return { remove: [], sightings: input.sightings };
    }

    const sightings = nextSightings(input);

    const sizes = new Map(input.entries.map((entry) => [entry.name, entry]));
    const named = new Set(input.owners.flatMap((owner) => owner.files));
    const taken = new Set<string>();
    const remove: Group[] = [];

    const groupOf = (reason: GroupReason, owner: CacheOwner): Group => {
        const files = owner.files.filter((name) => CACHE_FILE_NAME.test(name) && sizes.has(name) && !taken.has(name));
        const bytes = [...files, owner.manifest].reduce((total, name) => total + (sizes.get(name)?.size ?? 0), 0);

        return { reason, files, manifest: owner.manifest, bytes };
    };

    const take = (group: Group): void => {
        remove.push(group);
        group.files.forEach((name) => taken.add(name));

        if (group.manifest !== null) {
            taken.add(group.manifest);
        }
    };

    const idle = input.owners.filter((owner) => !isLive(owner, input.live));

    for (const owner of idle) {
        const commit = owner.kind === 'stubs' ? stubsCommitOf(owner.path, input.stubsRoot) : null;

        if (commit !== null && !input.keptStubs.includes(commit) && input.probes[owner.path] === 'missing') {
            take(groupOf('stubs', owner));
        }
    }

    for (const owner of idle) {
        if (taken.has(owner.manifest) || owner.kind !== 'project') {
            continue;
        }

        const sighting = sightings[owner.path];
        const vanished = sighting !== undefined && sighting.count >= SIGHTINGS_MIN_COUNT && sighting.lastMs - sighting.firstMs >= SIGHTINGS_MIN_SPAN_MS;

        if (vanished && !isKnown(owner.path, input.knownFolders)) {
            take(groupOf('vanished', owner));
        } else if (owner.files.every((name) => !sizes.has(name))) {
            take(groupOf('emptied', owner));
        }
    }

    if (!input.live.anyProcess) {
        for (const entry of input.entries) {
            if (TEMPORARY_NAME.test(entry.name) && !taken.has(entry.name)) {
                take({ reason: 'abandoned', files: [entry.name], manifest: null, bytes: entry.size });
            }
        }
    }

    const total = input.entries.reduce((sum, entry) => sum + entry.size, 0) - remove.reduce((sum, group) => sum + group.bytes, 0);

    if (total > input.budget) {
        const candidates: Array<{ usedMs: number; group: Group }> = idle
            .filter((owner) => !taken.has(owner.manifest))
            .map((owner) => ({ usedMs: owner.lastUsedMs, group: groupOf('budget', owner) }));

        if (!input.live.anyProcess) {
            for (const entry of input.entries) {
                if (CACHE_FILE_NAME.test(entry.name) && !named.has(entry.name) && !taken.has(entry.name)) {
                    candidates.push({ usedMs: entry.mtimeMs, group: { reason: 'budget', files: [entry.name], manifest: null, bytes: entry.size } });
                }
            }
        }

        candidates.sort((left, right) => left.usedMs - right.usedMs);

        let left = total;

        for (const candidate of candidates) {
            if (left <= input.budget) {
                break;
            }

            take(candidate.group);
            left -= candidate.group.bytes;
        }
    }

    return { remove, sightings };
}

/* A missing root is remembered per pass; a present one or one that could not be told apart forgets it. */
function nextSightings(input: EvictionInput): Sightings {
    const next: Sightings = {};

    for (const owner of input.owners) {
        if (owner.kind !== 'project' || input.probes[owner.path] !== 'missing') {
            continue;
        }

        const before = input.sightings[owner.path];
        next[owner.path] = { firstMs: before?.firstMs ?? input.now, lastMs: input.now, count: (before?.count ?? 0) + 1 };
    }

    return next;
}

/*
 * `missing` only when the root is gone for good reason: `ENOENT` or `ENOTDIR` with a parent that is a
 * folder we can list. A mount that is not there, a permission error or a slow network share is `unknown`.
 */
export async function probeRoot(path: string, timers: Timers = realTimers, timeoutMs = PROBE_TIMEOUT_MS): Promise<Probe> {
    const look = async (): Promise<Probe> => {
        try {
            await lstat(path);

            return 'present';
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;

            if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                return 'unknown';
            }
        }

        try {
            const parent = dirname(path);

            if (parent === path || !(await stat(parent)).isDirectory()) {
                return 'unknown';
            }

            await readdir(parent);

            return 'missing';
        } catch {
            return 'unknown';
        }
    };

    let cancel = (): void => undefined;

    const expired = new Promise<Probe>((resolve) => {
        cancel = timers.set(() => resolve('unknown'), timeoutMs);
    });

    try {
        return await Promise.race([look(), expired]);
    } finally {
        cancel();
    }
}

interface Listing {
    entries: CacheEntry[];
    owners: CacheOwner[];
    unreadableOwner: boolean;
}

function ownerOf(manifest: string, text: string): CacheOwner | null {
    try {
        const value = JSON.parse(text) as Record<string, unknown>;
        const { kind, path, folder, files, lastUsedMs } = value;

        if (
            value.format !== 1 ||
            (kind !== 'project' && kind !== 'stubs') ||
            typeof path !== 'string' ||
            typeof folder !== 'string' ||
            !Array.isArray(files) ||
            !files.every((name) => typeof name === 'string') ||
            typeof lastUsedMs !== 'number'
        ) {
            return null;
        }

        return { manifest, kind, path, folder, files, lastUsedMs };
    } catch {
        return null;
    }
}

/* One `opendir` of the top level, bounded; never a recursive scan. */
export async function listCache(folder: string, signal?: AbortSignal): Promise<Listing> {
    const listing: Listing = { entries: [], owners: [], unreadableOwner: false };
    let directory;

    try {
        directory = await opendir(folder);
    } catch {
        return listing;
    }

    let seen = 0;

    for await (const dirent of directory) {
        seen += 1;

        if (signal?.aborted || seen > MAX_ENTRIES) {
            break;
        }

        const stats = dirent.isFile() ? await lstat(join(folder, dirent.name)).catch(() => null) : null;

        if (stats === null || !stats.isFile()) {
            continue;
        }

        listing.entries.push({ name: dirent.name, size: stats.size, mtimeMs: stats.mtimeMs });

        if (!MANIFEST_NAME.test(dirent.name)) {
            continue;
        }

        const owner = ownerOf(dirent.name, await readFile(join(folder, dirent.name), 'utf8').catch(() => ''));

        if (owner === null) {
            listing.unreadableOwner = true;
        } else {
            listing.owners.push(owner);
        }
    }

    return listing;
}

async function readSightings(file: string): Promise<Sightings> {
    try {
        const value = JSON.parse(await readFile(file, 'utf8')) as { format?: number; roots?: Sightings };

        return value.format === SIGHTINGS_FORMAT && value.roots !== undefined ? value.roots : {};
    } catch {
        return {};
    }
}

async function writeSightings(file: string, roots: Sightings): Promise<void> {
    const partial = `${file}.${randomUUID()}.tmp`;

    await mkdir(dirname(file), { recursive: true });
    await writeFile(partial, JSON.stringify({ format: SIGHTINGS_FORMAT, roots }));
    await rename(partial, file);
}

export interface PhpCacheSweepOptions {
    /* The host's view of the PHP server's storage, or null while there is no host. */
    cache(): PhpCache | null;
    /* `language-servers/php-native/cache-sightings.json`, Ruimte's own and outside the server's storage. */
    sightingsFile: string;
    /* The folders of every project the machine knows, open or not. */
    knownFolders(): string[];
    probe?: (path: string) => Promise<Probe>;
    budget?: number;
}

/*
 * One pass over the PHP index caches: probes the owners' roots first, since a probe may wait on a
 * mount, then takes the gate, reads the folder and the live servers again and removes what the plan
 * names. Files go first and the manifest last, so a pass that stops halfway leaves an owner the next
 * pass sees as emptied.
 */
export async function sweepPhpCache(options: PhpCacheSweepOptions, now: number, signal: AbortSignal): Promise<Reclaimed> {
    const reclaimed: Reclaimed = { files: 0, bytes: 0 };
    const cache = options.cache();

    if (cache === null) {
        return reclaimed;
    }

    const folder = join(cache.storage, 'cache');
    const probe = options.probe ?? ((path: string) => probeRoot(path));
    const probes: Record<string, Probe> = {};

    for (const owner of (await listCache(folder, signal)).owners) {
        if (signal.aborted) {
            return reclaimed;
        }

        probes[owner.path] = await probe(owner.path);
    }

    return cache.hold(async () => {
        const listing = await listCache(folder, signal);

        const plan = planEviction({
            ...listing,
            live: { folders: cache.liveFolders(), stubsDirs: cache.liveStubsDirs(), anyProcess: cache.anyLive() },
            knownFolders: options.knownFolders(),
            probes,
            sightings: await readSightings(options.sightingsFile),
            stubsRoot: join(cache.storage, 'stubs'),
            keptStubs: cache.keptStubs,
            now,
            budget: options.budget ?? PHP_CACHE_BUDGET_BYTES
        });

        await writeSightings(options.sightingsFile, plan.sightings).catch(() => undefined);

        const sizes = new Map(listing.entries.map((entry) => [entry.name, entry.size]));
        let removals = 0;

        for (const group of plan.remove) {
            for (const name of [...group.files, ...(group.manifest === null ? [] : [group.manifest])]) {
                if (signal.aborted || removals >= MAX_REMOVALS) {
                    return reclaimed;
                }

                removals += 1;

                const removed = await unlink(join(folder, name)).then(
                    () => true,
                    () => false
                );

                if (removed) {
                    reclaimed.files += 1;
                    reclaimed.bytes += sizes.get(name) ?? 0;
                }
            }
        }

        return reclaimed;
    });
}
