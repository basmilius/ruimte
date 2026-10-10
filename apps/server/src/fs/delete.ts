import { relative, sep } from 'node:path';
import { CodedError } from '@adecore/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import { trashPath } from './trash.ts';
import { realEntryPath, realRoots, stateRefusal, type WriteBoundary } from './write.ts';

type DeleteErrorCode = 'not-found' | 'outside-project' | 'project-root' | 'git-state' | 'ruimte-state';

export class DeleteError extends CodedError<DeleteErrorCode> {}

/*
 * Moves a file or folder of an open project to the trash, inside the same boundary a save keeps.
 * A symbolic link is trashed as the link and never followed, so a link out of the project cannot
 * take its target along.
 */
export async function deletePath(path: string, boundary: WriteBoundary, trash: (path: string) => Promise<void> = trashPath): Promise<void> {
    const real = await realEntryPath(path);
    if (real === null) {
        throw new DeleteError('not-found', 'That path is not there');
    }
    const roots = await realRoots(boundary);
    const root = roots.find((candidate) => isInside(candidate, real));
    if (root === undefined) {
        throw new DeleteError('outside-project', `${path} is outside the projects open here and their worktrees`);
    }
    if (roots.includes(real)) {
        throw new DeleteError('project-root', 'A project folder is removed by closing the project, not from here');
    }
    const refused = stateRefusal(relative(root, real).split(sep), path, 'deleted');
    if (refused !== null) {
        throw new DeleteError(refused.code, refused.message);
    }
    await trash(real);
}
