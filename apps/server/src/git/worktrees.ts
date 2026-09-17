import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { Worktree, WorktreeWork } from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import { readProjectSettings, sharedPathOf } from '../projects/project-settings.ts';
import { checkpointIndexFile } from './checkpoints.ts';
import { resolveBase } from './status.ts';
import { GitError, git, gitOrThrow as run, runGit, toplevel } from './run.ts';
import { WorktreeRegister, type WorktreeRecord } from './worktree-register.ts';

// Branch names carry slashes; the folder name must not.
const safeName = (branch: string): string => branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';

/* The folder of one repository under the worktrees root; the name predates the register, so it stays. */
const repoFolderName = (main: string): string => `${basename(main)}-${createHash('sha1').update(main).digest('hex').slice(0, 8)}`;

// The files git leaves in a worktree's git dir while an operation waits halfway, with the word a person knows it by.
const OPERATIONS: ReadonlyArray<{ path: string; name: string }> = [
    { path: 'rebase-merge', name: 'rebase' },
    { path: 'rebase-apply', name: 'rebase' },
    { path: 'MERGE_HEAD', name: 'merge' },
    { path: 'CHERRY_PICK_HEAD', name: 'cherry-pick' },
    { path: 'REVERT_HEAD', name: 'revert' }
];

export interface WorktreeOrigin {
    projectId?: string;
    nodeId?: string;
    madeBy: 'verb' | 'client' | 'fork';
}

export interface RemoveOptions {
    force?: boolean;
    keepBranch?: boolean;
    /* The branch a squash just put this worktree's content on; its commits then no longer count as work. */
    squashedInto?: string;
}

export interface WorktreeState {
    entry: Listed | null;
    /* The register key, which is the path git reported when the worktree was made. */
    key: string | null;
    record: WorktreeRecord | undefined;
    missing: boolean;
    work: WorktreeWork;
    target: string | null;
    label: string;
}

export interface RemoveResult {
    branchDeleted: boolean;
    branchCommit?: string;
}

/* One entry of `git worktree list --porcelain`. */
export interface Listed {
    path: string;
    /* Null on a detached HEAD. */
    branch: string | null;
    head: string | null;
    locked: boolean;
    prunable: boolean;
}

// Written once above the lines the daemon adds, so a person reading the file knows where they came from.
const EXCLUDE_HEADER = '# Ruimte: shared paths linked into worktrees';

/* Whether anything is at a path, a symlink whose target is gone included. */
const linkExists = (path: string): Promise<boolean> =>
    lstat(path).then(
        () => true,
        () => false
    );

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

const parsePorcelain = (output: string): Listed[] => {
    const entries: Listed[] = [];
    let current: Listed | null = null;
    for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
            current = { path: line.slice('worktree '.length), branch: null, head: null, locked: false, prunable: false };
            entries.push(current);
        } else if (!current) {
            continue;
        } else if (line.startsWith('HEAD ')) {
            current.head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
            current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line === 'locked' || line.startsWith('locked ')) {
            current.locked = true;
        } else if (line === 'prunable' || line.startsWith('prunable ')) {
            current.prunable = true;
        }
    }
    return entries;
};

/* Tracked changes and untracked files out of `status --porcelain=v2 -z`, one per file. */
export const countStatus = (output: string): { changed: number; untracked: number } => {
    const fields = output.split('\0');
    let changed = 0;
    let untracked = 0;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!;
        if (field.startsWith('1 ') || field.startsWith('u ')) {
            changed += 1;
        } else if (field.startsWith('2 ')) {
            changed += 1;
            // A rename or copy carries the path it came from as the next field.
            i += 1;
        } else if (field.startsWith('? ')) {
            untracked += 1;
        }
    }
    return { changed, untracked };
};

const workSentence = (branch: string, work: WorktreeWork, target: string | null): string => {
    const parts = [
        `${work.changed} uncommitted ${work.changed === 1 ? 'file' : 'files'}`,
        `${work.untracked} new ${work.untracked === 1 ? 'file' : 'files'}`,
        `${work.ahead} ${work.ahead === 1 ? 'commit' : 'commits'} that ${target ?? 'no other branch'} lacks`
    ];
    const operation = work.operation === undefined ? '' : `, and a ${work.operation} stopped halfway`;
    return `${branch} holds ${parts[0]}, ${parts[1]} and ${parts[2]}${operation}`;
};

export const hasWork = (work: WorktreeWork): boolean => work.changed + work.untracked + work.ahead > 0 || work.operation !== undefined;

/*
 * Worktrees of a repository, kept under the app data dir so the repository itself stays clean:
 * `$RUIMTE_HOME/worktrees/<repo name>-<hash of its path>/<branch>`, with `worktrees.json` beside them.
 * Git is the truth about which worktrees exist; the register adds where each was made from and for
 * which node. Nothing in here removes a worktree that holds work unless it is told to with force.
 */
export class Worktrees {
    readonly root: string;
    private readonly checkpointsRoot: string;
    private readonly now: () => number;
    private readonly log: (line: string) => void;
    private readonly sinks = new Map<string, SessionSink>();
    // One removal at a time per repository, so two clients never inspect the same worktree against each other's half-done work.
    private readonly locks = new Map<string, Promise<unknown>>();

    constructor(home: string, now: () => number = Date.now, log: (line: string) => void = console.error) {
        this.root = join(home, 'worktrees');
        this.checkpointsRoot = join(home, 'checkpoints');
        this.now = now;
        this.log = log;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    /* The register of a repository, by its main checkout. */
    registerOf(main: string): WorktreeRegister {
        return new WorktreeRegister(join(this.root, repoFolderName(main)));
    }

    async list(repo: string, options: { inspect?: boolean } = {}): Promise<Worktree[]> {
        const { main, entries } = await this.read(repo);
        const records = await this.registerOf(main).read();
        const listed = await Promise.all(
            entries.map(async (entry): Promise<Worktree> => {
                const record = records.get(entry.path);
                const missing = entry.prunable || !(await exists(entry.path));
                return {
                    path: entry.path,
                    branch: entry.branch ?? '(detached)',
                    ...(record ? recordFields(record) : {}),
                    ...(missing ? { missing: true } : {}),
                    ...(entry.locked ? { locked: true } : {}),
                    ...(options.inspect ? { work: (await this.inspect(main, entry, record, missing)).work } : {})
                };
            })
        );
        // A register entry whose worktree git no longer knows still has a branch with work on it, until that branch goes too.
        const known = new Set(entries.map((entry) => entry.path));
        for (const [path, record] of records) {
            if (known.has(path) || !(await this.branchExists(main, record.branch))) {
                continue;
            }
            listed.push({
                path,
                branch: record.branch,
                ...recordFields(record),
                missing: true,
                ...(options.inspect ? { work: (await this.inspect(main, null, record, true)).work } : {})
            });
        }
        return listed;
    }

    /* The local branches, so a new one can be named clear of them. */
    async branches(repo: string): Promise<string[]> {
        const top = await toplevel(repo);
        const output = await run(['branch', '--list', '--format=%(refname:short)'], top);
        return output.split('\n').filter((line) => line !== '');
    }

    /*
     * The worktree for a branch, made when missing; a branch that does not exist yet is created from
     * HEAD of the checkout `repo` is in. What it was made from goes in the register: that checkout's
     * branch, and the commit the new branch shares with it.
     */
    async add(repo: string, branch: string, origin: WorktreeOrigin = { madeBy: 'client' }): Promise<{ worktree: Worktree; created: boolean }> {
        const { main, entries } = await this.read(repo);
        const existing = entries.find((entry) => entry.path !== main && entry.branch === branch);
        if (existing) {
            const record = (await this.registerOf(main).read()).get(existing.path);
            return { worktree: { path: existing.path, branch, ...(record ? recordFields(record) : {}) }, created: false };
        }
        const register = this.registerOf(main);
        const dir = join(this.root, repoFolderName(main));
        await mkdir(dir, { recursive: true, mode: 0o700 });
        // Git answers real paths, and the register is keyed on what git answers.
        const path = join(await realpath(dir), safeName(branch));
        const branchExists = await this.branchExists(main, branch);
        const fromBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo))?.trim();
        const head = (await git(['rev-parse', 'HEAD'], repo))?.trim();
        const fork = branchExists && head ? (await git(['merge-base', `refs/heads/${branch}`, head], repo))?.trim() : head;
        await run(branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path], main);
        const record: WorktreeRecord | null = fork
            ? {
                  branch,
                  from: { ...(fromBranch && fromBranch !== 'HEAD' ? { branch: fromBranch } : {}), commit: fork },
                  ...(origin.projectId === undefined ? {} : { projectId: origin.projectId }),
                  ...(origin.nodeId === undefined ? {} : { nodeId: origin.nodeId }),
                  madeBy: origin.madeBy,
                  branchMade: !branchExists,
                  madeAt: this.now()
              }
            : null;
        if (record) {
            await register.put(path, record);
        }
        await this.linkShared(repo, path).catch((e: unknown) =>
            this.log(`Linking the shared paths into ${path} failed: ${e instanceof Error ? e.message : String(e)}`)
        );
        this.announce(main);
        return { worktree: { path, branch, ...(record ? recordFields(record) : {}) }, created: true };
    }

    /* Writes down the node a worktree was made for, once the node has an id. */
    async claim(repo: string, path: string, nodeId: string): Promise<void> {
        const { main } = await this.read(repo);
        let changed = false;
        await this.registerOf(main).update((records) => {
            const record = records.get(path);
            if (record && record.nodeId !== nodeId) {
                records.set(path, { ...record, nodeId });
                changed = true;
            }
        });
        if (changed) {
            this.announce(main);
        }
    }

    /*
     * Removes a worktree and, when the register says the daemon made its branch, that branch. Without
     * force a worktree holding work is refused with the counts, and so is a locked one; a branch is
     * deleted without force only when every commit on it is on the target already.
     */
    async remove(repo: string, path: string, options: RemoveOptions = {}): Promise<RemoveResult> {
        const { main } = await this.read(repo);
        return await this.serialize(main, () => this.removeHeld(main, path, options));
    }

    /*
     * Runs work that inspects and changes the worktrees of a repository while no removal or merge of
     * another client does, with the main checkout it resolved to.
     */
    async exclusive<T>(repo: string, work: (main: string) => Promise<T>): Promise<T> {
        const { main } = await this.read(repo);
        return await this.serialize(main, () => work(main));
    }

    /*
     * What the daemon knows about one worktree right now: the entry git lists (null when only the
     * register still has its branch), its register record, and the work it holds against its target.
     */
    async describe(main: string, path: string): Promise<WorktreeState> {
        const { entries } = await this.read(main);
        const records = await this.registerOf(main).read();
        const wanted = resolve(path);
        const entry = entries.find((candidate) => candidate.path !== main && resolve(candidate.path) === wanted) ?? null;
        const key = entry?.path ?? [...records.keys()].find((candidate) => resolve(candidate) === wanted) ?? null;
        const record = key === null ? undefined : records.get(key);
        if (entry === null && (record === undefined || !(await this.branchExists(main, record.branch)))) {
            if (key !== null) {
                await this.registerOf(main).delete(key);
            }
            throw new GitError('worktree-not-found', `${path} is not a worktree of ${main}`);
        }
        const missing = entry === null || entry.prunable || !(await exists(entry.path));
        const { work, target } = await this.inspect(main, entry, record, missing);
        return { entry, key, record, missing, work, target, label: entry?.branch ?? record?.branch ?? basename(wanted) };
    }

    /* Every checkout of the repository, the main one first, with the branch each has out. */
    async checkouts(repo: string): Promise<Array<{ path: string; branch: string | null }>> {
        await toplevel(repo);
        return parsePorcelain(await run(['worktree', 'list', '--porcelain'], repo))
            .filter((entry) => !entry.prunable)
            .map((entry) => ({ path: entry.path, branch: entry.branch }));
    }

    /* `remove` for a caller that already holds the repository through `exclusive`. */
    async removeHeld(main: string, path: string, options: RemoveOptions = {}): Promise<RemoveResult> {
        const { entry, key, record, missing, work: counted, target, label } = await this.describe(main, path);
        // A squash leaves the branch's commits off the target while their content is on it; that is not work to lose.
        const squashed =
            options.squashedInto !== undefined && entry?.branch !== null && entry !== null && (await this.contentIn(main, entry.branch, options.squashedInto));
        const work = squashed ? { ...counted, ahead: 0 } : counted;
        if (!options.force && hasWork(work)) {
            throw new GitError('worktree-has-work', `${workSentence(label, work, target)}. Remove it with force to lose that.`);
        }
        if (!options.force && entry?.locked) {
            throw new GitError('worktree-locked', `${label} is locked with "git worktree lock". Remove it with force to override the lock.`);
        }

        if (entry !== null) {
            await this.removeCheckout(main, entry, missing);
        }

        const branch = this.branchToDelete(entry, record, options.keepBranch);
        let result: RemoveResult = { branchDeleted: false };
        if (branch !== null && (await this.branchExists(main, branch)) && (work.ahead === 0 || options.force)) {
            const commit = (await git(['rev-parse', `refs/heads/${branch}`], main))?.trim();
            // -D even when merged: -d asks whether HEAD of the main checkout has it, which is not the target the count was against.
            const deleted = await runGit(['branch', '-D', branch], main);
            result = deleted.code === 0 ? { branchDeleted: true, ...(commit ? { branchCommit: commit } : {}) } : { branchDeleted: false };
        }

        if (key !== null) {
            await this.registerOf(main).delete(key);
        }
        await rm(join(this.checkpointsRoot, checkpointIndexFile(entry?.path ?? resolve(path))), { force: true });
        this.announce(main);
        return result;
    }

    /*
     * Whether everything a branch changed is on the target already, whatever else the target gained:
     * merging it would leave the target's tree as it is. A squash resolved differently from the branch
     * is not, and then deleting the branch would lose its version.
     */
    private async contentIn(main: string, branch: string, target: string): Promise<boolean> {
        const merged = await runGit(['merge-tree', '--write-tree', `refs/heads/${target}`, `refs/heads/${branch}`], main);
        const tree = (await git(['rev-parse', `refs/heads/${target}^{tree}`], main))?.trim();
        return merged.code === 0 && tree !== undefined && merged.stdout.split('\n')[0]?.trim() === tree;
    }

    /*
     * Share only untracked, ignored paths; otherwise the symlink would appear as a worktree change.
     * Add the link itself to `info/exclude` because directory-only ignore patterns do not match it.
     */
    private async linkShared(folder: string, worktree: string): Promise<void> {
        const share = (await readProjectSettings(folder)).worktrees?.share ?? [];
        if (share.length === 0) {
            return;
        }
        const top = await toplevel(folder);
        const prefix = ((await git(['rev-parse', '--show-prefix'], folder)) ?? '').trim();
        const excluded: string[] = [];
        for (const wanted of share) {
            const path = sharedPathOf(wanted);
            if (path === null) {
                this.log(`Not sharing ${wanted} with ${worktree}: a shared path stays inside the project folder.`);
                continue;
            }
            const source = join(folder, path);
            if (!(await linkExists(source))) {
                continue;
            }
            const inRepository = `${prefix}${path}`;
            if (((await git(['ls-files', '-z', '--', `:(literal)${inRepository}`], top)) ?? '') !== '') {
                this.log(`Not sharing ${path} with ${worktree}: git tracks it, so a link would show as a change there.`);
                continue;
            }
            if ((await runGit(['check-ignore', '-q', '--', inRepository], top)).code !== 0) {
                this.log(`Not sharing ${path} with ${worktree}: git does not ignore it, so a link would count as a new file there. Add it to .gitignore.`);
                continue;
            }
            const target = join(worktree, prefix, path);
            if (await linkExists(target)) {
                continue;
            }
            await mkdir(dirname(target), { recursive: true });
            await symlink(source, target);
            excluded.push(`/${inRepository}`);
        }
        if (excluded.length > 0) {
            await this.exclude(top, excluded);
        }
    }

    /* Adds lines to the repository's own `info/exclude`, the ignore file every worktree reads and no commit carries. */
    private async exclude(top: string, lines: readonly string[]): Promise<void> {
        const common = (await git(['rev-parse', '--git-common-dir'], top))?.trim();
        if (!common) {
            return;
        }
        const file = join(isAbsolute(common) ? common : join(top, common), 'info', 'exclude');
        await this.serialize(file, async () => {
            const current = await readFile(file, 'utf8').catch(() => '');
            const present = new Set(current.split('\n').map((line) => line.trim()));
            const missing = lines.filter((line) => !present.has(line));
            if (missing.length === 0) {
                return;
            }
            const header = present.has(EXCLUDE_HEADER) ? [] : [EXCLUDE_HEADER];
            const separator = current === '' || current.endsWith('\n') ? '' : '\n';
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, `${current}${separator}${[...header, ...missing].join('\n')}\n`);
        });
    }

    /* The main checkout of the repository a path is in, and every other worktree git lists. */
    private async read(repo: string): Promise<{ main: string; entries: Listed[] }> {
        await toplevel(repo);
        const entries = parsePorcelain(await run(['worktree', 'list', '--porcelain'], repo));
        const main = entries[0]?.path;
        if (main === undefined) {
            throw new GitError('not-a-repo', `${repo} is not inside a git repository`);
        }
        return { main, entries: entries.slice(1) };
    }

    private async branchExists(main: string, branch: string): Promise<boolean> {
        return (await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], main)).code === 0;
    }

    /*
     * What the commits are counted against: the branch the worktree was made from while it exists,
     * then the repository's base, then the commit it was made from. Null only for a repository with
     * none of those, where a commit counts when no other branch has it.
     */
    private async targetOf(main: string, record: WorktreeRecord | undefined): Promise<string | null> {
        if (record?.from.branch !== undefined && (await this.branchExists(main, record.from.branch))) {
            return record.from.branch;
        }
        const base = await resolveBase(main);
        if (base !== null) {
            return base;
        }
        if (record && (await runGit(['rev-parse', '--verify', '--quiet', `${record.from.commit}^{commit}`], main)).code === 0) {
            return record.from.commit;
        }
        return null;
    }

    private async inspect(
        main: string,
        entry: Listed | null,
        record: WorktreeRecord | undefined,
        missing: boolean
    ): Promise<{ work: WorktreeWork; target: string | null }> {
        const target = await this.targetOf(main, record);
        // HEAD and every branch the worktree is or was on: a rebase that stopped leaves HEAD on the target while the branch still holds the commits.
        const branches = [...new Set([entry?.branch, record?.branch].filter((name): name is string => typeof name === 'string'))];
        const tips: string[] = entry?.head ? [entry.head] : [];
        for (const name of branches) {
            if (await this.branchExists(main, name)) {
                tips.push(`refs/heads/${name}`);
            }
        }
        let ahead = 0;
        if (tips.length > 0) {
            const not = target === null ? [...branches.map((name) => `--exclude=refs/heads/${name}`), '--branches'] : [target];
            const counted = await git(['rev-list', '--count', ...tips, '--not', ...not], main);
            ahead = counted === null ? 0 : Number.parseInt(counted.trim(), 10) || 0;
        }
        let behind = 0;
        if (tips.length > 0 && target !== null) {
            const counted = await git(['rev-list', '--count', target, '--not', ...tips], main);
            behind = counted === null ? 0 : Number.parseInt(counted.trim(), 10) || 0;
        }
        const moved = behind > 0 ? { behind } : {};
        if (missing || entry === null) {
            return { work: { changed: 0, untracked: 0, ahead, ...moved }, target };
        }
        const status = await run(['status', '--porcelain=v2', '-z', '-uall', '--ignore-submodules=all'], entry.path);
        const { changed, untracked } = countStatus(status);
        const operation = await this.operationIn(entry.path);
        return { work: { changed, untracked, ahead, ...(operation === null ? {} : { operation }), ...moved }, target };
    }

    async operationIn(path: string): Promise<string | null> {
        const output = await git(['rev-parse', ...OPERATIONS.flatMap((operation) => ['--git-path', operation.path])], path);
        if (output === null) {
            return null;
        }
        const paths = output.split('\n').filter((line) => line !== '');
        for (const [index, operation] of OPERATIONS.entries()) {
            const found = paths[index];
            if (found !== undefined && (await exists(isAbsolute(found) ? found : join(path, found)))) {
                return operation.name;
            }
        }
        return null;
    }

    private async removeCheckout(main: string, entry: Listed, missing: boolean): Promise<void> {
        // The work check already ran, so what force still overrides here is ignored files, submodules and a lock.
        const force = entry.locked ? ['--force', '--force'] : ['--force'];
        const removed = await runGit(['worktree', 'remove', ...force, entry.path], main);
        if (removed.code === 0) {
            return;
        }
        if (missing && !entry.locked) {
            // A git that cannot remove a worktree whose folder is gone still prunes it; prune only touches entries in that state.
            await run(['worktree', 'prune'], main);
            return;
        }
        throw new GitError('git-failed', removed.stderr.trim() || 'git worktree remove failed');
    }

    /*
     * The branch that goes with a worktree: the one the register made, only while the worktree is
     * still on it, since an agent that switched branches inside it leaves two names and neither is
     * safe to guess. A branch the register does not know, or one that existed before its worktree,
     * goes only when asked for explicitly.
     */
    private branchToDelete(entry: Listed | null, record: WorktreeRecord | undefined, keepBranch: boolean | undefined): string | null {
        if (keepBranch === true) {
            return null;
        }
        if (record && (record.branchMade || keepBranch === false)) {
            return entry === null || entry.branch === record.branch ? record.branch : null;
        }
        return keepBranch === false ? (entry?.branch ?? null) : null;
    }

    private serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
        const next = (this.locks.get(key) ?? Promise.resolve()).then(work, work);
        this.locks.set(
            key,
            next.catch(() => undefined)
        );
        return next;
    }

    announce(main: string): void {
        for (const sink of this.sinks.values()) {
            sink({ event: 'git.worktrees', payload: { repo: main } });
        }
    }
}

const recordFields = (record: WorktreeRecord): Pick<Worktree, 'from' | 'projectId' | 'nodeId' | 'madeAt'> => ({
    from: record.from,
    ...(record.projectId === undefined ? {} : { projectId: record.projectId }),
    ...(record.nodeId === undefined ? {} : { nodeId: record.nodeId }),
    madeAt: record.madeAt
});
