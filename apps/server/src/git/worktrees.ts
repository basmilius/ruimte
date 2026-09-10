import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Worktree } from '@ruimte/contracts';
import { GitError, gitOrThrow as run, toplevel } from './run.ts';

// Branch names carry slashes; the folder name must not.
const safeName = (branch: string): string => branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';

/*
 * Worktrees of a repository, kept under the app data dir so the repository itself stays
 * clean: `$RUIMTE_HOME/worktrees/<repo name>-<hash of its path>/<branch>`.
 */
export class Worktrees {
    readonly root: string;

    constructor(home: string) {
        this.root = join(home, 'worktrees');
    }

    async list(repo: string): Promise<Worktree[]> {
        const top = await this.toplevel(repo);
        const output = await run(['worktree', 'list', '--porcelain'], top);
        const worktrees: Worktree[] = [];
        let current: { path: string; branch: string | null } | null = null;
        for (const line of output.split('\n')) {
            if (line.startsWith('worktree ')) {
                current = { path: line.slice('worktree '.length), branch: null };
                worktrees.push(current as Worktree);
            } else if (line.startsWith('branch ') && current) {
                current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
            } else if (line === 'detached' && current) {
                current.branch = '(detached)';
            }
        }
        return worktrees.map((entry) => ({ path: entry.path, branch: entry.branch ?? '(detached)' })).filter((entry) => entry.path !== top);
    }

    /* The worktree for a branch, made when missing; a branch that does not exist yet is created from HEAD. */
    async add(repo: string, branch: string): Promise<{ worktree: Worktree; created: boolean }> {
        const top = await this.toplevel(repo);
        const existing = (await this.list(top)).find((entry) => entry.branch === branch);
        if (existing) {
            return { worktree: existing, created: false };
        }
        const dir = join(this.root, `${basename(top)}-${createHash('sha1').update(top).digest('hex').slice(0, 8)}`);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const path = join(dir, safeName(branch));
        const branchExists = await run(['branch', '--list', branch], top).then((out) => out.trim() !== '');
        await run(branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path], top);
        return { worktree: { path, branch }, created: true };
    }

    async remove(repo: string, path: string): Promise<void> {
        const top = await this.toplevel(repo);
        const known = (await this.list(top)).some((entry) => resolve(entry.path) === resolve(path));
        if (!known) {
            throw new GitError('worktree-not-found', `${path} is not a worktree of ${top}`);
        }
        await run(['worktree', 'remove', '--force', path], top);
    }

    private async toplevel(repo: string): Promise<string> {
        return await toplevel(repo);
    }
}
