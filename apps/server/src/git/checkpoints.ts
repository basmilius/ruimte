import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { diffTrees } from './diff.ts';
import { GitError, git, gitOrThrow, runGit } from './run.ts';

export interface CheckpointService {
    take(cwd: string): Promise<string | null>;
    diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null>;
    /* The diff of a turn that ended, with the tree of the folder it was taken against: where that turn left the files. */
    settle(cwd: string, tree: string): Promise<{ diff: ChatCheckpointDiff; after: string } | null>;
}

/* The name of the index file a checkout's turns are written through; removing a worktree removes it too. */
export const checkpointIndexFile = (top: string): string => `${basename(top)}-${createHash('sha1').update(top).digest('hex').slice(0, 8)}.index`;

// One index per repository, and one turn at a time in it: two chats in the same folder would
// otherwise fight over the lock file git writes next to it.
const queues = new Map<string, Promise<unknown>>();

const serialize = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
    queues.set(
        key,
        next.catch(() => undefined)
    );
    return next;
};

/*
 * Git trees of a chat's folder, one per turn, so the changed-files card can show what the working
 * tree holds now against what it held when the turn started. The tree is written through an index
 * file of ours (`GIT_INDEX_FILE`), so the person's own index, their stashes and their commits are
 * never touched; `git add -A` against that index means ignored files stay ignored and untracked
 * ones count. A folder outside a repository, or a git that fails, answers null and the card falls
 * back to what the CLI itself reported.
 */
export class Checkpoints implements CheckpointService {
    readonly root: string;

    constructor(home: string) {
        this.root = join(home, 'checkpoints');
    }

    /* The tree of the working tree as it is now, or null when there is nothing to check point. */
    async take(cwd: string): Promise<string | null> {
        const top = await this.toplevel(cwd);
        if (top === null) {
            return null;
        }
        const index = await this.indexFile(top);
        if (index === null) {
            return null;
        }
        return await serialize(index, async () => {
            const env = { GIT_INDEX_FILE: index };
            if ((await git(['add', '-A'], top, env)) === null) {
                return null;
            }
            const tree = await git(['write-tree'], top, env);
            return tree === null ? null : tree.trim() || null;
        });
    }

    /*
     * What changed since that tree under the chat's own folder: one unified diff per file, with the
     * counts the card shows. The tree holds the whole repository, but a chat in a subfolder (or in a
     * worktree of its own, which is its own repository root) only answers for what lies under it.
     */
    async diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null> {
        return (await this.settle(cwd, tree))?.diff ?? null;
    }

    async settle(cwd: string, tree: string): Promise<{ diff: ChatCheckpointDiff; after: string } | null> {
        const top = await this.toplevel(cwd);
        const prefix = await git(['rev-parse', '--show-prefix'], cwd);
        if (top === null || prefix === null) {
            return null;
        }
        // The working tree as a tree of its own, so files the agent created are in the comparison
        // (`git diff <tree>` against the working tree only sees what git already tracks).
        const now = await this.take(cwd);
        if (now === null) {
            return null;
        }
        const diff = await diffTrees(top, tree, now, prefix.trim());
        return diff === null ? null : { diff, after: now };
    }

    /* Whether git still has a tree; one no ref points at is collected after a while. */
    async exists(cwd: string, tree: string): Promise<boolean> {
        return (await runGit(['cat-file', '-e', `${tree}^{tree}`], cwd)).code === 0;
    }

    /*
     * Puts a checkout's files to a tree and its index back on HEAD, so what differs from HEAD stays as
     * unstaged changes, the way the agent left it. Ignored files were never in the tree and stay.
     * Only ever run on a checkout nobody works in yet: it throws away what the working tree held.
     */
    async restore(cwd: string, tree: string): Promise<void> {
        const top = await this.toplevel(cwd);
        if (top === null) {
            throw new GitError('not-a-repo', `${cwd} is not inside a git repository`);
        }
        await gitOrThrow(['read-tree', '-u', '--reset', tree], top);
        await gitOrThrow(['reset', '--quiet'], top);
    }

    private async toplevel(cwd: string): Promise<string | null> {
        const top = await git(['rev-parse', '--show-toplevel'], cwd);
        return top === null ? null : top.trim() || null;
    }

    private async indexFile(top: string): Promise<string | null> {
        try {
            await mkdir(this.root, { recursive: true, mode: 0o700 });
        } catch {
            return null;
        }
        return join(this.root, checkpointIndexFile(top));
    }
}
