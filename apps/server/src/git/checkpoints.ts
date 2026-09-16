import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { diffTrees } from './diff.ts';
import { git } from './run.ts';

export interface CheckpointService {
    take(cwd: string): Promise<string | null>;
    diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null>;
}

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
        return await diffTrees(top, tree, now, prefix.trim());
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
        return join(this.root, `${basename(top)}-${createHash('sha1').update(top).digest('hex').slice(0, 8)}.index`);
    }
}
