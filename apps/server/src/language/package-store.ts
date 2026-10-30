import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileExists } from '@adecore/agents';
import { sha256, sha256Of } from '../artifacts/artifact-fs.ts';
import type { LanguageRuntime, RunCommand } from './runtime.ts';

const SETS = 'packages';
const STAGING = '.staging';
const SET_FILE = 'set.json';
const SET_NAME = 'ruimte-language-packages';
const JOURNAL = '.journal';
const ASIDE = '.adopting';

/* A set id is 16 hex digits; anything else in the folder is not Ruimte's to remove. */
const SET_ID = /^[0-9a-f]{16}$/;

export interface PackageStoreOptions {
    /* `$RUIMTE_HOME/language-servers`. */
    root: string;
    runtime: LanguageRuntime;
    run: RunCommand;
    now: () => number;
    platform?: string;
    arch?: string;
}

/* `set.json`: what a set was installed from, written last so a set without it was never finished. */
export interface PackageSetRecord {
    format: 1;
    dependencies: Record<string, string>;
    platform: string;
    arch: string;
    installedAt: number;
    files: number;
    bytes: number;
}

/* What adoption did with the packages of an install that held its own: moved into a new set, replaced by a link to an identical set, or left alone because the set differs. */
export type Adoption = 'moved' | 'linked' | 'kept';

/* A hold on a set: while it is out, `collect` leaves the set alone. */
export interface Lease {
    readonly setId: string;
    /* The folder of the set, with its `package.json`, `bun.lock`, `node_modules` and `set.json`. */
    readonly folder: string;
    release(): void;
}

/*
 * Immutable package sets under `language-servers/packages/<setId>`: one `bun install` result, identified by
 * what it pins plus platform, shared by every install that pins the same. A set is built in a staging folder
 * on the same file system and published with one rename, so it is whole or absent. A set is never written
 * after it is published; the installs only link to it.
 */
export class PackageStore {
    private readonly options: PackageStoreOptions;
    private readonly platform: string;
    private readonly arch: string;
    private readonly leases = new Map<string, number>();
    private readonly building = new Map<string, Promise<void>>();
    /* Serializes the check of a set against a collection, so `collect` never removes a set that `ensure` is about to hand out. */
    private tail: Promise<unknown> = Promise.resolve();

    constructor(options: PackageStoreOptions) {
        this.options = options;
        this.platform = options.platform ?? process.platform;
        this.arch = options.arch ?? process.arch;
    }

    /* `language-servers/packages`. */
    get directory(): string {
        return join(this.options.root, SETS);
    }

    /* The id of the set that holds these dependencies on this platform; the kind is no part of it. */
    setIdOf(dependencies: Record<string, string>): string {
        const entries = Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right));
        return sha256(JSON.stringify({ deps: entries, platform: this.platform, arch: this.arch })).slice(0, 16);
    }

    folderOf(setId: string): string {
        return join(this.directory, setId);
    }

    /*
     * Hands out the set of these dependencies, building it when it is absent or does not hold every entry the
     * caller needs (paths below `node_modules`). Callers asking for the same set while it builds share the build.
     */
    async ensure(dependencies: Record<string, string>, entries: readonly string[], log: (line: string) => void): Promise<Lease> {
        const setId = this.setIdOf(dependencies);
        // The lease is taken before anything is awaited, so a collection that runs meanwhile sees it.
        const lease = this.lease(setId);

        try {
            if (!(await this.exclusive(() => this.isWhole(setId, entries)))) {
                let build = this.building.get(setId);

                if (build === undefined) {
                    build = this.build(setId, dependencies, entries, log).finally(() => this.building.delete(setId));
                    this.building.set(setId, build);
                }

                await build;

                if (!(await this.isWhole(setId, entries))) {
                    throw new Error(`The package set ${setId} does not hold every package this server needs`);
                }
            }

            return lease;
        } catch (error) {
            lease.release();
            throw error;
        }
    }

    /*
     * Removes the sets that no install refers to and no lease holds. `references` returns the ids in use, or
     * null when the disk could not be read in full, and then nothing is removed.
     */
    collect(references: () => Promise<Set<string> | null>): Promise<string[]> {
        return this.exclusive(async () => {
            // Taken before the references are read. An install links its set before it releases the lease, so a lease gone by the time of this look is in the references; one looked at only after them may have been released by an install that linked too late for them.
            const held = new Set(this.leases.keys());
            const used = await references();

            if (used === null) {
                return [];
            }

            const removed: string[] = [];
            const present = (await readdir(this.directory).catch(() => [] as string[])).sort();

            for (const setId of present) {
                if (!SET_ID.test(setId) || used.has(setId) || held.has(setId) || this.leases.has(setId) || this.building.has(setId)) {
                    continue;
                }

                // Moved out of the way first, so a crash in the middle of `rm` leaves staging and not a half set under its id.
                const trash = join(this.directory, STAGING, `removed-${setId}-${randomUUID().slice(0, 8)}`);

                await mkdir(join(this.directory, STAGING), { recursive: true });
                await rename(this.folderOf(setId), trash);
                await rm(trash, { recursive: true, force: true });
                removed.push(setId);
            }

            return removed;
        });
    }

    /*
     * Clears what an interrupted install left in staging, since a set is never in staging once published, and
     * finishes or undoes the adoptions a crash cut short.
     */
    async recover(): Promise<void> {
        await rm(join(this.directory, STAGING), { recursive: true, force: true });

        for (const name of await readdir(join(this.directory, JOURNAL)).catch(() => [] as string[])) {
            const setId = name.replace(/\.json$/, '');

            if (SET_ID.test(setId)) {
                await this.exclusive(() => this.replay(setId));
            }
        }
    }

    /*
     * Gives the packages an install holds in its own `node_modules` to the store. A set that does not exist yet
     * takes the folder itself (one rename, so nothing is copied). A set that does exist replaces it only after
     * every file proved identical; a different one stays unshared and the next update shares it.
     */
    adopt(folder: string): Promise<Adoption | null> {
        return this.exclusive(() => this.adoptFolder(folder));
    }

    async readRecord(setId: string): Promise<PackageSetRecord | null> {
        try {
            return JSON.parse(await readFile(join(this.folderOf(setId), SET_FILE), 'utf8')) as PackageSetRecord;
        } catch {
            return null;
        }
    }

    private async adoptFolder(folder: string): Promise<Adoption | null> {
        const modules = join(folder, 'node_modules');
        const dependencies = await readDependencies(folder);

        if (dependencies === null) {
            return null;
        }

        const setId = this.setIdOf(dependencies);

        await this.settleAside(folder, setId);

        if (!(await lstat(modules).catch(() => null))?.isDirectory()) {
            return null;
        }

        const set = this.folderOf(setId);

        if (await fileExists(join(set, SET_FILE))) {
            if (!(await sameTree(modules, join(set, 'node_modules')))) {
                return 'kept';
            }

            await rename(modules, `${modules}${ASIDE}`);
            await symlink(this.linkOf(folder, setId), modules, 'dir');
            await rm(`${modules}${ASIDE}`, { recursive: true, force: true });

            return 'linked';
        }

        // A folder under the id without a record is a set that is not ours to finish; this install keeps its packages.
        if (await lstat(set).catch(() => null)) {
            return 'kept';
        }

        await mkdir(join(this.directory, JOURNAL), { recursive: true });
        await writeFile(join(this.directory, JOURNAL, `${setId}.json`), `${JSON.stringify({ from: relative(this.options.root, folder) })}\n`);
        await mkdir(set, { recursive: true });
        await rename(modules, join(set, 'node_modules'));
        await this.finishMove(setId, folder, dependencies);

        return 'moved';
    }

    /* The rest of a move once `node_modules` is in the set: the lockfile and manifest, the link left behind, the record, and last the journal. */
    private async finishMove(setId: string, from: string, dependencies: Record<string, string>): Promise<void> {
        const set = this.folderOf(setId);
        const manifest = JSON.parse(await readFile(join(from, 'package.json'), 'utf8')) as { name?: string };

        await writeFile(join(set, 'package.json'), `${JSON.stringify({ name: SET_NAME, private: true, dependencies }, null, 2)}\n`);

        // The lockfile names the workspace after the kind it came from, which a set no longer has.
        const lock = await readFile(join(from, 'bun.lock'), 'utf8').catch(() => null);

        if (lock !== null) {
            await writeFile(join(set, 'bun.lock'), manifest.name === undefined ? lock : lock.replaceAll(manifest.name, SET_NAME));
        }

        if (!(await lstat(join(from, 'node_modules')).catch(() => null))) {
            await symlink(this.linkOf(from, setId), join(from, 'node_modules'), 'dir');
        }

        const { files, bytes } = await measure(join(set, 'node_modules'));
        const record: PackageSetRecord = { format: 1, dependencies, platform: this.platform, arch: this.arch, installedAt: this.options.now(), files, bytes };

        await writeFile(join(set, SET_FILE), `${JSON.stringify(record)}\n`);
        await rm(join(this.directory, JOURNAL, `${setId}.json`), { force: true });
    }

    /* A crash between the two renames of a link adoption leaves the packages aside; they become the link's target again or go. */
    private async settleAside(folder: string, setId: string): Promise<void> {
        const modules = join(folder, 'node_modules');
        const aside = `${modules}${ASIDE}`;

        if (!(await lstat(aside).catch(() => null))) {
            return;
        }

        if (!(await lstat(modules).catch(() => null))) {
            if (await fileExists(join(this.folderOf(setId), SET_FILE))) {
                await symlink(this.linkOf(folder, setId), modules, 'dir');
            } else {
                await rename(aside, modules);

                return;
            }
        }

        await rm(aside, { recursive: true, force: true });
    }

    private async replay(setId: string): Promise<void> {
        const journal = join(this.directory, JOURNAL, `${setId}.json`);
        const set = this.folderOf(setId);
        const { from } = JSON.parse(await readFile(journal, 'utf8').catch(() => '{}')) as { from?: string };
        const folder = from === undefined ? null : join(this.options.root, from);
        const dependencies = folder === null ? null : await readDependencies(folder);

        if (folder !== null && dependencies !== null) {
            const modules = (await lstat(join(folder, 'node_modules')).catch(() => null)) ?? null;
            const moved = (await lstat(join(set, 'node_modules')).catch(() => null)) !== null;

            // Moved, and what is left of the install is nothing or a link: the remaining steps are safe to run again.
            if (moved && (modules === null || modules.isSymbolicLink())) {
                await this.finishMove(setId, folder, dependencies);

                return;
            }
        }

        // The packages never left the install, or there is nothing to link back: the half set goes and adoption starts over.
        await rm(set, { recursive: true, force: true });
        await rm(journal, { force: true });
    }

    /* The target of an install's link, relative so the whole folder can move. */
    private linkOf(folder: string, setId: string): string {
        return relative(folder, join(this.folderOf(setId), 'node_modules'));
    }

    private lease(setId: string): Lease {
        let released = false;

        this.leases.set(setId, (this.leases.get(setId) ?? 0) + 1);

        return {
            setId,
            folder: this.folderOf(setId),
            release: () => {
                if (released) {
                    return;
                }

                const left = (this.leases.get(setId) ?? 1) - 1;

                released = true;

                if (left <= 0) {
                    this.leases.delete(setId);
                } else {
                    this.leases.set(setId, left);
                }
            }
        };
    }

    private exclusive<T>(work: () => Promise<T>): Promise<T> {
        const result = this.tail.then(work, work);

        this.tail = result.catch(() => undefined);

        return result;
    }

    private async isWhole(setId: string, entries: readonly string[]): Promise<boolean> {
        const folder = this.folderOf(setId);

        if (!(await fileExists(join(folder, SET_FILE)))) {
            return false;
        }

        return (await Promise.all(entries.map((entry) => fileExists(join(folder, 'node_modules', entry))))).every(Boolean);
    }

    private async build(setId: string, dependencies: Record<string, string>, entries: readonly string[], log: (line: string) => void): Promise<void> {
        const staging = join(this.directory, STAGING, `${setId}-${randomUUID().slice(0, 8)}`);

        try {
            await mkdir(staging, { recursive: true });
            await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: SET_NAME, private: true, dependencies }, null, 2)}\n`);

            log(
                `Installing ${Object.entries(dependencies)
                    .map(([name, version]) => `${name}@${version}`)
                    .join(', ')}`
            );

            const { runtime } = this.options;

            const code = await this.options.run(
                { command: runtime.command, args: [...runtime.args, 'install', '--ignore-scripts'], cwd: staging, env: runtime.env },
                log
            );

            if (code !== 0) {
                throw new Error(`The installer exited with code ${code}`);
            }

            for (const entry of entries) {
                if (!(await fileExists(join(staging, 'node_modules', entry)))) {
                    throw new Error(`The install did not leave ${join(this.folderOf(setId), 'node_modules', entry)}`);
                }
            }

            const { files, bytes } = await measure(join(staging, 'node_modules'));
            const record: PackageSetRecord = {
                format: 1,
                dependencies,
                platform: this.platform,
                arch: this.arch,
                installedAt: this.options.now(),
                files,
                bytes
            };

            await writeFile(join(staging, SET_FILE), `${JSON.stringify(record)}\n`);
            await this.publish(setId, staging, entries);
        } finally {
            await rm(staging, { recursive: true, force: true });
        }
    }

    /* One rename makes the set appear. A set that is already there was published by another daemon or an earlier run, and is used when it is whole. */
    private async publish(setId: string, staging: string, entries: readonly string[]): Promise<void> {
        const target = this.folderOf(setId);

        for (const attempt of [0, 1]) {
            try {
                await rename(staging, target);

                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;

                // Windows answers EPERM for a rename onto a folder that exists; elsewhere it is a real refusal.
                const exists = code === 'EEXIST' || code === 'ENOTEMPTY' || (code === 'EPERM' && process.platform === 'win32');

                if (!exists) {
                    throw error;
                }

                if (await this.isWhole(setId, entries)) {
                    return;
                }

                if (attempt === 1) {
                    throw error;
                }

                // A folder under the id that is not whole was never published by this store; it is replaced.
                await rm(target, { recursive: true, force: true });
            }
        }
    }
}

/* The files below a folder and their size, with links counted as entries and not followed. */
async function measure(folder: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;

    for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
        if (entry.isDirectory()) {
            continue;
        }

        files++;

        if (entry.isFile()) {
            bytes += (await lstat(join(entry.parentPath, entry.name))).size;
        }
    }

    return { files, bytes };
}

async function readDependencies(folder: string): Promise<Record<string, string> | null> {
    try {
        const { dependencies } = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };

        return dependencies ?? null;
    } catch {
        return null;
    }
}

/* What a tree holds, by path: its type, and for a file its mode and SHA-256, for a link its target. */
async function describeTree(folder: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const files: string[] = [];

    for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
        const path = join(entry.parentPath, entry.name);
        const name = relative(folder, path);

        if (entry.isDirectory()) {
            found.set(name, 'directory');
        } else if (entry.isSymbolicLink()) {
            found.set(name, `link:${await readlink(path)}`);
        } else if (entry.isFile()) {
            found.set(name, `file:${((await lstat(path)).mode & 0o777).toString(8)}`);
            files.push(name);
        } else {
            found.set(name, 'other');
        }
    }

    for (let i = 0; i < files.length; i += 64) {
        await Promise.all(
            files.slice(i, i + 64).map(async (name) => {
                found.set(name, `${found.get(name)}:${await sha256Of(join(folder, name))}`);
            })
        );
    }

    return found;
}

/* Whether two trees hold the same paths, types, modes, link targets and bytes. */
async function sameTree(left: string, right: string): Promise<boolean> {
    const [first, second] = await Promise.all([describeTree(left), describeTree(right)]);

    if (first.size !== second.size) {
        return false;
    }

    return [...first].every(([name, description]) => second.get(name) === description);
}
