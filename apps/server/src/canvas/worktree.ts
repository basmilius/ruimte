import type { Worktree } from '@ruimte/contracts';
import { VerbRefusal, type VerbCall } from './verb.ts';

export const WORKTREE_LINES: readonly string[] = [
    "worktree\tEach agent gets a git worktree of its own under the machine's worktrees folder, on a new branch from HEAD, and starts in it; two agents editing the same file never overwrite each other",
    'worktree\tThe branch is named after the task or the title, with -2, -3 when that name is taken; the turn diff of each agent shows only its own worktree',
    'worktree\tNothing removes a worktree on its own: merging and removing it is for a person'
];

/* A branch name out of a title: lower case, only what every ref takes, and never empty. */
export const branchSlug = (title: string): string => {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/, '');
    return slug === '' ? 'agent' : slug;
};

/* The first of base, base-2, base-3 that no branch has yet, so two agents never end up on one worktree. */
export const freeBranch = (base: string, taken: ReadonlySet<string>): string => {
    if (!taken.has(base)) {
        return base;
    }
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
};

/* The branches of the project's repository, refusing a project that is not in one. */
export const branchesForWorktrees = async (call: VerbCall, folder: string | null): Promise<Set<string>> => {
    const branches = folder === null ? null : await call.host.branchesOf(folder);
    if (branches === null) {
        throw new VerbRefusal('not-a-repository', `--worktree needs a git repository, and ${folder ?? 'this project'} is not in one`);
    }
    return new Set(branches);
};

/*
 * The worktrees of one call, made before the project is written so the nodes can start in them.
 * `undo` takes back the ones made here when the write is refused; one that already existed stays.
 */
export const makeWorktrees = async (
    call: VerbCall,
    place: { folder: string; projectId: string },
    branches: readonly string[]
): Promise<{ worktrees: Worktree[]; undo(): Promise<void> }> => {
    const folder = place.folder;
    const made: Worktree[] = [];
    const worktrees: Worktree[] = [];
    const undo = async (): Promise<void> => {
        for (const worktree of made) {
            await call.host.removeWorktree(folder, worktree.path).catch(() => undefined);
        }
    };
    for (const branch of branches) {
        try {
            const { worktree, created } = await call.host.addWorktree(folder, branch, place.projectId);
            worktrees.push(worktree);
            if (created) {
                made.push(worktree);
            }
        } catch (e) {
            await undo();
            throw new VerbRefusal('worktree-failed', `The worktree for ${branch} could not be made: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return { worktrees, undo };
};
