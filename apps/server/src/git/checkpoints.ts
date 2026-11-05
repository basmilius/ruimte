import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { KeyedSerializer } from '@adecore/utils/async';
import type { ChatCheckpointDiff } from '@ruimte/contracts';
import { MachineHome } from '../fs/machine-home.ts';
import { diffTrees } from './diff.ts';
import { git, gitOrThrow, leavingOut, repositoryRoot, runGit, toplevel, verifyRev } from './run.ts';

export interface CheckpointService {
    take(cwd: string): Promise<string | null>;
    diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null>;
    /* The diff of a turn that ended, with the tree of the folder it was taken against: where that turn left the files. */
    settle(cwd: string, tree: string): Promise<{ diff: ChatCheckpointDiff; after: string } | null>;
    /* The commit HEAD points at, or null when unborn or outside a repository. */
    head(cwd: string): Promise<string | null>;
}

/* A folder's name with a short hash of its path, unique per checkout and still readable on disk. */
export function folderKey(path: string): string {
    return `${basename(path)}-${createHash('sha1').update(path).digest('hex').slice(0, 8)}`;
}

/* The name of the index file a checkout's turns are written through; removing a worktree removes it too. */
export function checkpointIndexFile(top: string): string {
    return `${folderKey(top)}.index`;
}

// One index per repository, and one turn at a time in it: two chats in the same folder would
// otherwise fight over the lock file git writes next to it.
const queue = new KeyedSerializer();

/*
 * Capture each turn as a git tree through a private `GIT_INDEX_FILE`, leaving the person's index,
 * stashes and commits untouched. Failure returns null so the UI can use the CLI's change report.
 */
export class Checkpoints implements CheckpointService {
    readonly root: string;
    private readonly machineHome: MachineHome;

    constructor(home: string) {
        this.root = join(home, 'checkpoints');
        this.machineHome = new MachineHome(home);
    }

    /* The tree of the working tree as it is now, or null when there is nothing to checkpoint. */
    async take(cwd: string): Promise<string | null> {
        const top = await repositoryRoot(cwd);
        return top === null ? null : await this.takeAt(top);
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
        const [top, prefix] = await Promise.all([repositoryRoot(cwd), git(['rev-parse', '--show-prefix'], cwd)]);
        if (top === null || prefix === null) {
            return null;
        }
        // The working tree as a tree of its own, so files the agent created are in the comparison
        // (`git diff <tree>` against the working tree only sees what git already tracks).
        const now = await this.takeAt(top);
        if (now === null) {
            return null;
        }
        // A tree taken before the home was left out still holds it, so the diff leaves it out too.
        const diff = await diffTrees(top, tree, now, prefix.trim(), undefined, await this.machineHome.stateWithin(top));
        return diff === null ? null : { diff, after: now };
    }

    head(cwd: string): Promise<string | null> {
        return verifyRev('HEAD^{commit}', cwd);
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
        const top = await toplevel(cwd);
        await gitOrThrow(['read-tree', '-u', '--reset', tree], top);
        await gitOrThrow(['reset', '--quiet'], top);
    }

    private async takeAt(top: string): Promise<string | null> {
        try {
            await mkdir(this.root, { recursive: true, mode: 0o700 });
        } catch {
            return null;
        }
        const index = join(this.root, checkpointIndexFile(top));
        const leftOut = await this.machineHome.stateWithin(top);
        return await queue.run(index, async () => {
            const env = { GIT_INDEX_FILE: index };
            if ((await git(['add', '-A', ...leavingOut(leftOut)], top, env)) === null) {
                return null;
            }
            // The index lives on between turns and may still hold what an earlier daemon added from the home.
            const stale = leftOut.map((path) => `:(literal)${path}`);
            if (stale.length > 0 && (await git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', ...stale], top, env)) === null) {
                return null;
            }
            return (await git(['write-tree'], top, env))?.trim() || null;
        });
    }
}
