import { isWithin } from '@adecore/utils/path';
import type { GitDiffResult, Worktree, WorktreeMergePayload, WorktreeMergeResult } from '@ruimte/contracts';
import { realOrNull } from '../disk/real-path.ts';
import { diffCheckout } from './diff.ts';
import { mergeBaseWith } from './status.ts';
import type { WorktreeMerge } from './worktree-merge.ts';
import type { Worktrees } from './worktrees.ts';

let merges = 0;

/* A worktree a tool asks for: a new branch named after a title, or the branch it was given. */
export type WorktreeWant = ({ fresh: string } | { branch: string }) & { base?: string };

/* The repository a project folder is in, as far as a node that starts in it goes. */
export interface CheckoutHost {
    /* The worktrees of the repository the folder is in; empty when it is not in one. */
    paths(folder: string): Promise<string[]>;
    /* The local branches of the repository the folder is in; null when it is in none. */
    branches(folder: string): Promise<string[] | null>;
    /*
     * A worktree under the machine's worktrees folder, made from HEAD when the branch is new. `fresh`
     * is always a new one, on the first free branch after that name; `branch` takes that branch and
     * may answer a worktree it already has, unless that one was made for another node.
     */
    add(folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }>;
    /* Writes the node a worktree was made for into the register, once the node exists. */
    claim(folder: string, path: string, nodeId: string): Promise<void>;
    /* Takes back a worktree this call made, when the write it was made for is refused. */
    remove(folder: string, path: string): Promise<unknown>;
}

export interface WorktreeHost {
    list(folder: string): Promise<Worktree[]>;
    /* Everything a worktree holds over where it was made from, uncommitted and untracked files included. */
    diff(path: string, base: string | undefined): Promise<GitDiffResult>;
    /*
     * Merges a worktree under the limits an agent is held to: its loose work committed first, only
     * into a clean checkout, a conflict taken back and refused, no agent stopped and nothing removed.
     */
    merge(payload: Omit<WorktreeMergePayload, 'actionId' | 'stopAgent' | 'commitFirst' | 'into' | 'remove'>): Promise<WorktreeMergeResult>;
}

/* What the `worktree` tool reaches git through: the same register, diff and merge a person's panel uses. */
export function worktreeHost(worktrees: Worktrees, merge: WorktreeMerge): WorktreeHost {
    return {
        list: (folder) => worktrees.list(folder, { inspect: true }),
        diff: async (path, base) => diffCheckout(path, await mergeBaseWith(path, base)),
        merge: (payload) =>
            merge.merge({ ...payload, actionId: `tool-merge-${++merges}`, commitFirst: true }, () => undefined, {
                cleanTarget: true,
                abortOnConflict: true
            })
    };
}

/* What a tool that starts a node in a worktree reaches the machine's worktrees through. */
export function checkoutHost(worktrees: Worktrees): CheckoutHost {
    return {
        paths: (folder) => madeWorktreePaths(worktrees, folder).catch(() => []),
        branches: (folder) => worktrees.branches(folder).catch(() => null),
        add: (folder, want, projectId) => addWanted(worktrees, folder, want, projectId),
        claim: (folder, path, nodeId) => worktrees.claim(folder, path, nodeId),
        remove: (folder, path) => worktrees.remove(folder, path)
    };
}

/*
 * The worktrees git lists that sit under the machine's worktree folder or that the daemon made, the rule a
 * save follows (`fs/write.ts`). Git takes a worktree's path from `.git/worktrees/<id>/gitdir`, a plain file in
 * the project, so a path only git names could point anywhere.
 */
async function madeWorktreePaths(worktrees: Worktrees, folder: string): Promise<string[]> {
    const [listed, registered, root] = await Promise.all([
        worktrees.list(folder),
        worktrees.registeredPaths(folder).catch(() => [] as string[]),
        realOrNull(worktrees.root)
    ]);
    const made = new Set(await Promise.all(registered.map(realOrNull)));
    const kept = await Promise.all(
        listed.map(async ({ path }) => {
            const real = await realOrNull(path);

            return real !== null && ((root !== null && isWithin(root, real)) || made.has(real)) ? path : null;
        })
    );

    return kept.filter((path) => path !== null);
}

async function addWanted(worktrees: Worktrees, folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }> {
    const options = want.base === undefined ? {} : { base: want.base };
    return 'branch' in want
        ? await worktrees.add(folder, want.branch, { madeBy: 'verb', projectId }, options)
        : { worktree: await worktrees.addFresh(folder, want.fresh, { madeBy: 'verb', projectId }, options), created: true };
}
