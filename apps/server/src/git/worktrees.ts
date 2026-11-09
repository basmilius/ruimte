import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { KeyedSerializer } from '@adecore/utils/async';
import { fileExists } from '@adecore/utils/fs';
import type { Worktree, WorktreeWork } from '@ruimte/contracts';
import { homeFolder } from '@ruimte/service/home';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';
import { checkpointIndexFile, folderKey } from './checkpoints.ts';
import { existingGitPaths } from './conflict.ts';
import { parseWorktreeList, type Listed } from './refs.ts';
import { GitError, READ_ONLY_GIT, git, gitOrThrow as run, runGit, toplevel, verifyRev } from './run.ts';
import { parsePorcelain, resolveBase } from './status.ts';
import type { WorktreeAgents } from './worktree-merge.ts';
import { WorktreeRegister, type WorktreeRecord } from './worktree-register.ts';

// Branch names carry slashes; the folder name must not.
function safeName(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';
}

// The files git leaves in a worktree's git dir while an operation waits halfway, with the word a person knows it by.
const OPERATIONS: ReadonlyArray<{ path: string; name: string }> = [
    { path: 'rebase-merge', name: 'rebase' },
    { path: 'rebase-apply', name: 'rebase' },
    { path: 'MERGE_HEAD', name: 'merge' },
    { path: 'CHERRY_PICK_HEAD', name: 'cherry-pick' },
    { path: 'REVERT_HEAD', name: 'revert' }
];

interface WorktreeOrigin {
    projectId?: string;
    nodeId?: string;
    madeBy: 'verb' | 'client' | 'fork';
}

interface RemoveOptions {
    force?: boolean;
    keepBranch?: boolean;
    /* Stops the agents working in the worktree first instead of refusing while one is in a turn. */
    stopAgent?: boolean;
    /* The branch a squash just put this worktree's content on; its commits then no longer count as work. */
    squashedInto?: string;
}

interface WorktreeState {
    entry: Listed | null;
    /* The register key, which is the path git reported when the worktree was made. */
    key: string | null;
    record: WorktreeRecord | undefined;
    missing: boolean;
    work: WorktreeWork;
    target: string | null;
    label: string;
}

interface RemoveResult {
    branchDeleted: boolean;
    branchCommit?: string;
}

/* Tracked changes and untracked files out of `status --porcelain=v2 -z`, one per file. */
export function countStatus(output: string): { changed: number; untracked: number } {
    const { entries } = parsePorcelain(output);
    const untracked = entries.filter((entry) => entry.untracked).length;
    return { changed: entries.length - untracked, untracked };
}

function workSentence(branch: string, work: WorktreeWork, target: string | null): string {
    const parts = [
        `${work.changed} uncommitted ${work.changed === 1 ? 'file' : 'files'}`,
        `${work.untracked} new ${work.untracked === 1 ? 'file' : 'files'}`,
        `${work.ahead} ${work.ahead === 1 ? 'commit' : 'commits'} that ${target ?? 'no other branch'} lacks`
    ];
    const operation = work.operation === undefined ? '' : `, and a ${work.operation} stopped halfway`;
    return `${branch} holds ${parts[0]}, ${parts[1]} and ${parts[2]}${operation}`;
}

/* The first of base, base-2, base-3 that is not taken yet. */
export function freeBranch(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) {
        return base;
    }
    for (let suffix = 2; ; suffix++) {
        const candidate = `${base}-${suffix}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}

export function hasWork(work: WorktreeWork): boolean {
    return work.changed + work.untracked + work.ahead > 0 || work.operation !== undefined;
}

/* What the worktrees need to know of work that came from another machine, which a folder cut from it carries along. */
interface ForeignWork {
    /* The local branches whose work another machine sent. */
    branches(): readonly string[];
    /* Writes down a folder, and the branch it is on, as one this machine never vouched for. */
    untrust(path: string, branch: string): Promise<void>;
}

/*
 * Worktrees of a repository, kept outside it so the repository itself stays clean:
 * `<worktree folder>/<repo name>-<hash of its path>/<branch>`, with `worktrees.json` in `$RUIMTE_HOME/worktrees`.
 * The worktree folder is that same folder until a person on the machine picks another, which only new worktrees follow.
 * Git is the truth about which worktrees exist; the register adds where each was made from and for
 * which node. Nothing in here removes a worktree that holds work unless it is told to with force.
 */
export class Worktrees {
    readonly root: string;
    private readonly checkpointsRoot: string;
    private readonly checkoutRoot: () => string | null;
    private readonly agents: WorktreeAgents;
    private readonly foreign: ForeignWork | undefined;
    private readonly now: () => number;
    private readonly sinks = new ClientSinks();
    // One removal at a time per repository, so two clients never inspect the same worktree against each other's half-done work.
    private readonly locks = new KeyedSerializer();

    constructor(
        home: string,
        /* The agents of the machine, so a removal can tell whether one is still working in the folder. */
        agents: WorktreeAgents,
        now: () => number = Date.now,
        // Where new checkouts go, read for each one; null keeps them beside the register.
        checkoutRoot: () => string | null = () => null,
        foreign?: ForeignWork
    ) {
        this.agents = agents;
        this.foreign = foreign;
        this.checkoutRoot = checkoutRoot;
        this.root = homeFolder(home, 'worktrees');
        this.checkpointsRoot = homeFolder(home, 'checkpoints');
        this.now = now;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The paths of the worktrees the daemon made for the repository a folder is in, wherever the worktree folder was then. */
    async registeredPaths(folder: string): Promise<string[]> {
        const { main } = await this.read(folder);
        return [...(await this.registerOf(main).read()).keys()];
    }

    /*
     * The main checkout of the repository a folder is in, and the worktrees the register made for an
     * agent's node. A worktree a person made themselves is not among them; null outside a repository.
     */
    async agentWorktrees(folder: string): Promise<{ main: string; paths: string[] } | null> {
        try {
            const { main } = await this.read(folder);
            const records = await this.registerOf(main).read();

            return { main, paths: [...records].filter(([, record]) => record.madeBy !== 'client' && record.nodeId !== undefined).map(([path]) => path) };
        } catch (error) {
            if (error instanceof GitError) {
                return null;
            }

            throw error;
        }
    }

    /* The register of a repository, by its main checkout. */
    registerOf(main: string): WorktreeRegister {
        return new WorktreeRegister(join(this.root, folderKey(main)));
    }

    async list(repo: string, options: { inspect?: boolean } = {}): Promise<Worktree[]> {
        const { main, entries } = await this.read(repo);
        const records = await this.registerOf(main).read();
        const listed = await Promise.all(
            entries.map(async (entry): Promise<Worktree> => {
                const record = records.get(entry.path);
                const missing = entry.prunable || !(await fileExists(entry.path));
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
     * branch, and the commit the new branch shares with it. An agent never lands in a worktree the
     * register gives to another node; a person may open any.
     */
    async add(
        repo: string,
        branch: string,
        origin: WorktreeOrigin = { madeBy: 'client' },
        options: MakeOptions = {}
    ): Promise<{ worktree: Worktree; created: boolean }> {
        const { main } = await this.read(repo);
        return await this.serialize(main, async () => {
            const { entries } = await this.read(repo);
            const existing = entries.find((entry) => entry.path !== main && entry.branch === branch);
            if (existing === undefined) {
                return { worktree: await this.make(repo, main, branch, origin, options), created: true };
            }
            const record = (await this.registerOf(main).read()).get(existing.path);
            if (origin.madeBy !== 'client' && record?.nodeId !== undefined && record.nodeId !== origin.nodeId) {
                throw new GitError('worktree-taken', `The worktree of ${branch} belongs to ${record.nodeId}; name another branch.`);
            }
            return { worktree: { path: existing.path, branch, ...(record ? recordFields(record) : {}) }, created: false };
        });
    }

    /*
     * A worktree on a new branch named `name`, or name-2, name-3 when that is taken. The name is picked
     * and the worktree made under the repository lock, so two agents started at once never share one.
     */
    async addFresh(repo: string, name: string, origin: WorktreeOrigin, options: MakeOptions = {}): Promise<Worktree> {
        const { main } = await this.read(repo);
        return await this.serialize(main, async () => {
            const { entries } = await this.read(repo);
            const taken = new Set([...(await this.branches(main)), ...entries.map((entry) => basename(entry.path))]);
            return await this.make(repo, main, freeBranch(name, taken), origin, options);
        });
    }

    private async make(repo: string, main: string, branch: string, origin: WorktreeOrigin, options: MakeOptions): Promise<Worktree> {
        const register = this.registerOf(main);
        const branchExists = await this.branchExists(main, branch);
        const based = options.base === undefined ? null : await this.resolveBase(repo, main, options.base, branchExists);
        const dir = join(this.checkoutRoot() ?? this.root, folderKey(main));
        await mkdir(dir, { recursive: true, mode: 0o700 });
        // Git answers real paths, and the register is keyed on what git answers.
        const path = join(await realpath(dir), safeName(branch));
        const fromBranch = based?.branch ?? (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo))?.trim();
        const head = based?.commit ?? (await git(['rev-parse', 'HEAD'], repo))?.trim();
        const fork = branchExists && head ? (await git(['merge-base', `refs/heads/${branch}`, head], repo))?.trim() : head;
        const hooks = options.hooksOff === true ? ['-c', 'core.hooksPath=/dev/null'] : [];
        // Before the folder exists: a branch cut from work another machine sent holds those files.
        if (await this.startsFromForeignWork(main, branchExists ? branch : null, based?.commit ?? null)) {
            await this.foreign!.untrust(path, branch);
        }
        await options.beforeAdd?.(path, branch);
        await run(
            [...hooks, ...(branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, ...(based ? [based.commit] : [])])],
            main
        );
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
        this.announce(main);
        return { path, branch, ...(record ? recordFields(record) : {}) };
    }

    /*
     * Whether the branch about to be checked out, or the commit a new one starts at, is the tip of a branch
     * that another machine's work arrived on: a recorded one, or any remote ref this machine keeps for a result.
     */
    private async startsFromForeignWork(main: string, existing: string | null, commit: string | null): Promise<boolean> {
        if (this.foreign === undefined || (existing === null && commit === null)) {
            return false;
        }
        const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'], main)) ?? '';
        const recorded = new Set(this.foreign.branches().map((name) => `refs/heads/${name}`));
        const tips = new Map<string, string>();
        for (const line of refs.split('\n')) {
            const [ref, sha] = line.split(' ');
            if (ref !== undefined && sha !== undefined) {
                tips.set(ref, sha);
            }
        }
        const foreignTips = new Set([...tips].filter(([ref]) => ref.startsWith('refs/remotes/ruimte-') || recorded.has(ref)).map(([, sha]) => sha));
        const started = [commit, existing === null ? null : (tips.get(`refs/heads/${existing}`) ?? null)];
        return started.some((sha) => sha !== null && foreignTips.has(sha));
    }

    /* The commit a new branch starts at, found before anything is made; the local branch name it was given by, when it was one. */
    private async resolveBase(repo: string, main: string, base: string, branchExists: boolean): Promise<{ commit: string; branch: string | null }> {
        if (branchExists) {
            throw new GitError('branch-exists', 'A base only applies to a new branch.');
        }
        const commit = await verifyRev(`${base}^{commit}`, repo);
        if (commit === null) {
            throw new GitError('ref-not-found', `${base} is not a branch, tag or commit of this repository.`);
        }
        return { commit, branch: (await this.branchExists(main, base)) ? base : null };
    }

    /*
     * Writes down the node a worktree was made for, once the node has an id. A worktree a person made
     * stays theirs when an agent lands in it, or that agent could merge the person's work as its own.
     */
    async claim(repo: string, path: string, nodeId: string): Promise<void> {
        const { main } = await this.read(repo);
        let changed = false;
        await this.registerOf(main).update((records) => {
            const record = records.get(path);
            if (record && record.madeBy !== 'client' && record.nodeId !== nodeId) {
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
        return await this.serialize(main, async () => {
            await this.settleAgents(main, path, options.stopAgent === true);
            return await this.removeHeld(main, path, options);
        });
    }

    /* Refuses while an agent is in a turn in the worktree, or stops the agents there when told to. */
    private async settleAgents(main: string, path: string, stop: boolean): Promise<void> {
        const { entry, record, label } = await this.describe(main, path);
        if (entry === null) {
            return;
        }
        const agents = this.agents.in(entry.path, record?.nodeId);
        const working = agents.filter((agent) => agent.working);
        if (working.length > 0 && !stop) {
            throw new GitError(
                'agent-working',
                `${working.length === 1 ? 'An agent is' : `${working.length} agents are`} still working in ${label}. Stop ${working.length === 1 ? 'it' : 'them'} first.`
            );
        }
        if (stop) {
            for (const agent of agents.filter((candidate) => candidate.live)) {
                await this.agents.stop(agent.nodeId);
            }
        }
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
        const missing = entry === null || entry.prunable || !(await fileExists(entry.path));
        const { work, target } = await this.inspect(main, entry, record, missing);
        return { entry, key, record, missing, work, target, label: entry?.branch ?? record?.branch ?? basename(wanted) };
    }

    /* Every checkout of the repository, the main one first, with the branch each has out. */
    async checkouts(repo: string): Promise<Array<{ path: string; branch: string | null }>> {
        return (await this.porcelain(repo)).filter((entry) => !entry.prunable).map((entry) => ({ path: entry.path, branch: entry.branch }));
    }

    /* `remove` for a caller that already holds the repository through `exclusive`. */
    async removeHeld(main: string, path: string, options: RemoveOptions = {}): Promise<RemoveResult> {
        const { entry, key, record, missing, work: counted, target, label } = await this.describe(main, path);
        // A squash leaves the branch's commits off the target while their content is on it; that is not work to lose.
        const squashed =
            options.squashedInto !== undefined && entry !== null && entry.branch !== null && (await this.contentIn(main, entry.branch, options.squashedInto));
        const work = squashed ? { ...counted, ahead: 0 } : counted;
        if (!options.force && hasWork(work)) {
            throw new GitError('worktree-has-work', `${workSentence(label, work, target)}. Remove it with force to lose that.`);
        }
        if (!options.force && entry?.locked) {
            throw new GitError('worktree-locked', `${label} is locked with "git worktree lock". Remove it with force to override the lock.`);
        }

        if (entry !== null) {
            await this.removeCheckout(main, entry, missing, options.force === true);
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

    /* The main checkout of the repository a path is in, and every other worktree git lists. */
    private async read(repo: string): Promise<{ main: string; entries: Listed[] }> {
        const entries = await this.porcelain(repo);
        const main = entries[0]?.path;
        if (main === undefined) {
            throw new GitError('not-a-repo', `${repo} is not inside a git repository`);
        }
        return { main, entries: entries.slice(1) };
    }

    /* Asks git once, without a `toplevel` first: a merge reads the list many times, and a process is
       what costs on Windows. Code 128 is git's answer outside a repository. */
    private async porcelain(repo: string): Promise<Listed[]> {
        const listed = await runGit(['worktree', 'list', '--porcelain'], repo);
        if (listed.code === 128) {
            throw new GitError('not-a-repo', `${repo} is not inside a git repository`);
        }
        if (listed.code !== 0) {
            throw new GitError('git-failed', listed.stderr.trim() || 'git worktree failed');
        }
        return parseWorktreeList(listed.stdout);
    }

    private async branchExists(main: string, branch: string): Promise<boolean> {
        return (await verifyRev(`refs/heads/${branch}`, main)) !== null;
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
        if (record && (await verifyRev(`${record.from.commit}^{commit}`, main)) !== null) {
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
        const count = async (args: string[]): Promise<number> => Number.parseInt((await git(['rev-list', '--count', ...args], main))?.trim() ?? '', 10) || 0;
        let ahead = 0;
        let behind = 0;
        if (tips.length > 0) {
            const not = target === null ? [...branches.map((name) => `--exclude=refs/heads/${name}`), '--branches'] : [target];
            ahead = await count([...tips, '--not', ...not]);
            behind = target === null ? 0 : await count([target, '--not', ...tips]);
        }
        const moved = behind > 0 ? { behind } : {};
        if (missing || entry === null) {
            return { work: { changed: 0, untracked: 0, ahead, ...moved }, target };
        }
        const [status, operation] = await Promise.all([
            run(['status', '--porcelain=v2', '-z', '-uall', '--ignore-submodules=all'], entry.path, READ_ONLY_GIT),
            this.operationIn(entry.path)
        ]);
        const { changed, untracked } = countStatus(status);
        return { work: { changed, untracked, ahead, ...(operation === null ? {} : { operation }), ...moved }, target };
    }

    async operationIn(path: string): Promise<string | null> {
        const present = await existingGitPaths(
            path,
            OPERATIONS.map((operation) => operation.path)
        );
        return OPERATIONS.find((operation) => present.has(operation.path))?.name ?? null;
    }

    private async removeCheckout(main: string, entry: Listed, missing: boolean, force: boolean): Promise<void> {
        // Without a person's force git does the last check itself, which closes the gap between the count and the removal.
        const flags = !force ? [] : entry.locked ? ['--force', '--force'] : ['--force'];
        const removed = await runGit(['worktree', 'remove', ...flags, entry.path], main);
        if (removed.code === 0) {
            return;
        }
        if (missing && !entry.locked) {
            // A git that cannot remove a worktree whose folder is gone still prunes it; prune only touches entries in that state.
            await run(['worktree', 'prune'], main);
            return;
        }
        if (!force) {
            const fresh = await this.describe(main, entry.path);
            if (hasWork(fresh.work)) {
                throw new GitError('worktree-has-work', `${workSentence(fresh.label, fresh.work, fresh.target)}. Remove it with force to lose that.`);
            }
            throw new GitError('worktree-refused', removed.stderr.trim() || 'git would not remove the worktree');
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
        return this.locks.run(key, work);
    }

    announce(main: string): void {
        this.sinks.emit({ event: 'git.worktrees', payload: { repo: main } });
    }
}

/* Where a new branch starts: a branch, a tag or a commit. */
interface MakeOptions {
    base?: string;
    /* Runs no hook of the repository while the checkout is made, for a tree that came from elsewhere. */
    hooksOff?: boolean;
    /* Called with the folder before git makes it, so a caller can write it down before anything of it exists. */
    beforeAdd?: (path: string, branch: string) => Promise<void>;
}

function recordFields(record: WorktreeRecord): Pick<Worktree, 'from' | 'projectId' | 'nodeId' | 'madeAt'> {
    return {
        from: record.from,
        ...(record.projectId === undefined ? {} : { projectId: record.projectId }),
        ...(record.nodeId === undefined ? {} : { nodeId: record.nodeId }),
        madeAt: record.madeAt
    };
}
