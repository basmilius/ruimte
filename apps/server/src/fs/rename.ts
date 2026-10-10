import { lstat, mkdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import { realEntryPath, realRoots, stateRefusal, type WriteBoundary } from './write.ts';

type RenameErrorCode =
    | 'bad-path'
    | 'not-found'
    | 'exists'
    | 'into-itself'
    | 'not-a-directory'
    | 'outside-project'
    | 'project-root'
    | 'git-state'
    | 'ruimte-state'
    | 'not-writable';

export class RenameError extends CodedError<RenameErrorCode> {}

async function realSource(path: string): Promise<string> {
    const real = await realEntryPath(path);
    if (real === null) {
        throw new RenameError('not-found', `${path} is not there`);
    }
    return real;
}

/* The real place the folder of a new path will have: the deepest folder that exists along it, with the names below it that do not yet. */
async function realTarget(path: string): Promise<string> {
    const missing: string[] = [];
    let current = dirname(path);
    for (;;) {
        const entry = await lstat(current).catch(() => null);
        if (entry !== null) {
            const base = await realpath(current).catch(() => null);
            if (base === null || !(await stat(base)).isDirectory()) {
                throw new RenameError('not-a-directory', `${current} is not a folder`);
            }
            return join(base, ...missing, basename(path));
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new RenameError('bad-path', `${path} has no folder to start from`);
        }
        missing.unshift(basename(current));
        current = parent;
    }
}

function failure(e: unknown, path: string): unknown {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return new RenameError('not-writable', `${path} cannot be moved`);
    }
    if (code === 'ENAMETOOLONG' || code === 'EINVAL') {
        return new RenameError('bad-path', `${path} is not a name this machine can store`);
    }
    if (code === 'ENOTDIR' || code === 'EISDIR') {
        return new RenameError('not-a-directory', `A part of ${path} is a file, not a folder`);
    }
    return e;
}

function assertOpenGround(segments: readonly string[], path: string): void {
    const refused = stateRefusal(segments, path, 'moved');
    if (refused !== null) {
        throw new RenameError(refused.code, refused.message);
    }
}

/* A move that passed every check; `run` makes it. */
export interface RenamePlan {
    run(): Promise<void>;
}

/*
 * Checks a move of a file or folder of an open project to another place, inside the boundary a save keeps and
 * outside what a delete keeps closed. A name that is taken is never overwritten, and a case-only change of a name
 * is the one case where the target is the source itself. Nothing is moved until `run`, so a caller can do
 * what has to come before the move knowing that the move will be allowed.
 */
export async function planRename(path: string, to: string, boundary: WriteBoundary): Promise<RenamePlan> {
    if (!isAbsolute(path) || !isAbsolute(to) || path.includes('\0') || to.includes('\0')) {
        throw new RenameError('bad-path', 'Both paths must be absolute');
    }
    const source = await realSource(resolve(path));
    const target = await realTarget(resolve(to));
    const roots = await realRoots(boundary);
    const sourceRoot = roots.find((candidate) => isInside(candidate, source));
    const targetRoot = roots.find((candidate) => isInside(candidate, target));
    if (sourceRoot === undefined || targetRoot === undefined) {
        throw new RenameError('outside-project', `${sourceRoot === undefined ? path : to} is outside the projects open here and their worktrees`);
    }
    if (roots.includes(source)) {
        throw new RenameError('project-root', 'A project folder is moved outside Ruimte, not from here');
    }
    assertOpenGround(relative(sourceRoot, source).split(sep), path);
    assertOpenGround(relative(targetRoot, target).split(sep), to);
    if (target !== source && isInside(source, target)) {
        throw new RenameError('into-itself', `${path} cannot be moved into itself`);
    }
    const taken = await lstat(target).catch(() => null);
    if (taken !== null) {
        const moving = await lstat(source);
        if (taken.dev !== moving.dev || taken.ino !== moving.ino) {
            throw new RenameError('exists', `${to} is already there`);
        }
    }
    return {
        run: async () => {
            try {
                await mkdir(dirname(target), { recursive: true });
                await rename(source, target);
            } catch (e) {
                throw failure(e, path);
            }
        }
    };
}

export async function renamePath(path: string, to: string, boundary: WriteBoundary): Promise<void> {
    await (await planRename(path, to, boundary)).run();
}
