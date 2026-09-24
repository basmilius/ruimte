import type { Worktree } from '@ruimte/contracts';
import { VerbRefusal, type VerbCall, type WorktreeWant } from './verb.ts';
import { errorText } from '../error-text.ts';
import type { Worktrees } from '../git/worktrees.ts';

export const WORKTREE_LINES: readonly string[] = [
    "worktree\tEach agent gets a git worktree of its own under the machine's worktrees folder, on a new branch from HEAD, and starts in it; two agents editing the same file never overwrite each other",
    'worktree\tThe branch is named after the task or the title, with -2, -3 when that name is taken; the turn diff of each agent shows only its own worktree',
    'worktree\tNothing removes a worktree on its own; ruimte-context worktree merge brings the work of an agent you opened back, and the worktree and its branch stay until a person removes them'
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

/* Refuses a project that is not in a git repository, before anything is made for it. */
export const requireRepository = async (call: VerbCall, folder: string): Promise<void> => {
    if ((await call.host.branchesOf(folder)) === null) {
        throw new VerbRefusal('not-a-repository', `--worktree needs a git repository, and ${folder} is not in one`);
    }
};

const nameOf = (want: WorktreeWant): string => ('branch' in want ? want.branch : want.fresh);

/* `CanvasHost.addWorktree` over the machine's worktrees. */
export const addWanted = async (
    worktrees: Worktrees,
    folder: string,
    want: WorktreeWant,
    projectId: string
): Promise<{ worktree: Worktree; created: boolean }> =>
    'branch' in want
        ? await worktrees.add(folder, want.branch, { madeBy: 'verb', projectId })
        : { worktree: await worktrees.addFresh(folder, want.fresh, { madeBy: 'verb', projectId }), created: true };

/*
 * The worktrees of one call, made before the project is written so the nodes can start in them.
 * `undo` takes back the ones made here when the write is refused; one that already existed stays.
 */
export const makeWorktrees = async (
    call: VerbCall,
    place: { folder: string; projectId: string },
    wants: readonly WorktreeWant[]
): Promise<{ worktrees: Worktree[]; undo(): Promise<void> }> => {
    const folder = place.folder;
    const made: Worktree[] = [];
    const worktrees: Worktree[] = [];
    const undo = async (): Promise<void> => {
        for (const worktree of made) {
            await call.host.removeWorktree(folder, worktree.path).catch(() => undefined);
        }
    };
    for (const want of wants) {
        try {
            const { worktree, created } = await call.host.addWorktree(folder, want, place.projectId);
            worktrees.push(worktree);
            if (created) {
                made.push(worktree);
            }
        } catch (e) {
            await undo();
            throw new VerbRefusal('worktree-failed', `The worktree for ${nameOf(want)} could not be made: ${errorText(e)}`);
        }
    }
    return { worktrees, undo };
};
