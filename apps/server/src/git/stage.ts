import type { GitDiscardResult } from '@ruimte/contracts';
import { git, gitOrThrow, toplevel } from './run.ts';

// Paths come from a status of ours, so they mean themselves and never a glob git would expand.
const literal = (paths: readonly string[]): string[] => paths.map((path) => `:(literal)${path}`);

/* A stash that says where it came from, so `git stash list` reads as a list of undos. */
export const discardStashName = (at: Date = new Date()): string => `ruimte-discard-${at.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')}`;

/* Puts the paths in the index, deletions included: `git add` records a file that is gone. */
export const stagePaths = async (cwd: string, paths: readonly string[]): Promise<void> => {
    const top = await toplevel(cwd);
    await gitOrThrow(['add', '--', ...literal(paths)], top);
};

/* Takes them back out again, leaving the working tree alone. */
export const unstagePaths = async (cwd: string, paths: readonly string[]): Promise<void> => {
    const top = await toplevel(cwd);
    // A repository without a commit has no HEAD to restore from, so the index is emptied instead.
    const born = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], top))?.trim();
    await gitOrThrow(born ? ['restore', '--staged', '--', ...literal(paths)] : ['rm', '--cached', '-r', '--', ...literal(paths)], top);
};

/*
 * Throwing work away, without throwing it away: the paths go into a stash of their own first, so
 * `git stash pop` is the way back for as long as the person wants it. `stash push` is what resets
 * the working tree here, index and all, which is why nothing else has to run after it. Git writes
 * no stash at all when the paths hold nothing to save, and that answers null.
 */
export const discardPaths = async (cwd: string, paths: readonly string[]): Promise<GitDiscardResult> => {
    const top = await toplevel(cwd);
    const name = discardStashName();
    await gitOrThrow(['stash', 'push', '--include-untracked', '--message', name, '--', ...literal(paths)], top);
    const latest = (await git(['stash', 'list', '--format=%gs', '-1'], top))?.trim() ?? '';
    return { stash: latest.includes(name) ? name : null };
};
