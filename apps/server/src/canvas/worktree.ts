import { ToolRefusal } from '@adecore/agents/context';
import { slugOf, type Worktree } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { WorktreeWant } from '../git/worktree-host.ts';
import { type AgentCall } from './host.ts';

/* A branch name out of a title: lower case, only what every ref takes, and never empty. */
export function branchSlug(title: string): string {
    return slugOf(title, 'agent');
}

/* Refuses a project that is not in a git repository, before anything is made for it. */
export async function requireRepository(call: AgentCall, folder: string): Promise<void> {
    if ((await call.host.checkouts.branches(folder)) === null) {
        throw new ToolRefusal('not-a-repository', `worktree needs a git repository, and ${folder} is not in one`);
    }
}

function nameOf(want: WorktreeWant): string {
    return 'branch' in want ? want.branch : want.fresh;
}

/*
 * The worktrees of one call, made before the project is written so the nodes can start in them.
 * `undo` takes back the ones made here when the write is refused; one that already existed stays.
 */
export async function makeWorktrees(
    call: AgentCall,
    place: { folder: string; projectId: string },
    wants: readonly WorktreeWant[]
): Promise<{ worktrees: Worktree[]; undo(): Promise<void> }> {
    const folder = place.folder;
    const made: Worktree[] = [];
    const worktrees: Worktree[] = [];
    const undo = async (): Promise<void> => {
        for (const worktree of made) {
            await call.host.checkouts
                .remove(folder, worktree.path)
                .catch((e: unknown) => console.warn(`Taking back the worktree ${worktree.path} failed:`, errorText(e)));
        }
    };
    for (const want of wants) {
        try {
            const { worktree, created } = await call.host.checkouts.add(folder, want, place.projectId);
            worktrees.push(worktree);
            if (created) {
                made.push(worktree);
            }
        } catch (e) {
            await undo();
            throw new ToolRefusal('worktree-failed', `The worktree for ${nameOf(want)} could not be made: ${errorText(e)}`);
        }
    }
    return { worktrees, undo };
}
