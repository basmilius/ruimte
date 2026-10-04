import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { CodedError } from '@ruimte/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import { trashPath } from './trash.ts';
import { realRoots, type WriteBoundary } from './write.ts';

type DeleteErrorCode = 'not-found' | 'outside-project' | 'project-root' | 'git-state' | 'ruimte-state';

export class DeleteError extends CodedError<DeleteErrorCode> {}

/*
 * Moves a file or folder of an open project to the trash, inside the same boundary a save keeps.
 * A symbolic link is trashed as the link and never followed, so a link out of the project cannot
 * take its target along.
 */
export async function deletePath(path: string, boundary: WriteBoundary, trash: (path: string) => Promise<void> = trashPath): Promise<void> {
    const entry = await lstat(path).catch(() => null);
    if (entry === null) {
        throw new DeleteError('not-found', 'That path is not there');
    }
    // A link keeps its own name; anything else is named the way the disk spells it, so `.GIT` on a volume that ignores case is `.git`.
    const real = await (entry.isSymbolicLink() ? realpath(dirname(path)).then((folder) => join(folder, basename(path))) : realpath(path)).catch(() => null);
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
    const segments = relative(root, real).split(sep);
    // Submodules and repositories beside the project carry a `.git` of their own, so any level counts.
    if (segments.includes('.git')) {
        throw new DeleteError('git-state', `${path} is part of a repository's own state and is not deleted from here`);
    }
    if (segments[0] === '.ruimte') {
        throw new DeleteError('ruimte-state', `${path} is Ruimte's own state and is not deleted from here`);
    }
    await trash(real);
}
