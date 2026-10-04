import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES, type FsCreatePayload, type FsCreateResult } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import { realRoots, type WriteBoundary } from './write.ts';

type CreateErrorCode = 'bad-path' | 'exists' | 'not-a-directory' | 'outside-project' | 'git-state' | 'ruimte-state' | 'too-large' | 'not-writable';

export class CreateError extends CodedError<CreateErrorCode> {}

/*
 * The real path of the deepest folder that exists along `path`, and the names below it that do not.
 * A link along the way is followed, since that is where the new entry would really land.
 */
async function deepestExisting(path: string): Promise<{ base: string; missing: string[] }> {
    const missing: string[] = [];
    let current = path;
    for (;;) {
        const entry = await lstat(current).catch(() => null);
        if (entry !== null) {
            const base = await realpath(current).catch(() => null);
            if (base === null) {
                throw new CreateError('not-a-directory', `${current} is a link that leads nowhere`);
            }
            if (missing.length > 0 && !(await stat(base)).isDirectory()) {
                throw new CreateError('not-a-directory', `${current} is a file, not a folder`);
            }
            return { base, missing };
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new CreateError('bad-path', `${path} has no folder to start from`);
        }
        missing.unshift(basename(current));
        current = parent;
    }
}

function failure(e: unknown, path: string): unknown {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
        return new CreateError('exists', `${path} is already there`);
    }
    if (code === 'ENOTDIR') {
        return new CreateError('not-a-directory', `A part of ${path} is a file, not a folder`);
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return new CreateError('not-writable', `${path} cannot be created`);
    }
    if (code === 'ENAMETOOLONG' || code === 'EINVAL') {
        return new CreateError('bad-path', `${path} is not a name this machine can store`);
    }
    return e;
}

/*
 * Creates a file or a folder of an open project, inside the boundary a save keeps and outside what
 * a delete keeps closed. The location is judged on real paths before anything is made, and the
 * entry itself is made with `O_EXCL` or a plain `mkdir`, so a name that appears in between is
 * `exists` and never overwritten.
 */
export async function createEntry(payload: FsCreatePayload, boundary: WriteBoundary): Promise<FsCreateResult> {
    const { path, kind } = payload;
    if (!isAbsolute(path) || path.includes('\0')) {
        throw new CreateError('bad-path', 'The path must be absolute');
    }
    const target = resolve(path);
    if (await lstat(target).catch(() => null)) {
        throw new CreateError('exists', `${target} is already there`);
    }
    const { base, missing } = await deepestExisting(target);
    const real = join(base, ...missing);
    const roots = await realRoots(boundary);
    const root = roots.find((candidate) => isInside(candidate, real));
    if (root === undefined) {
        throw new CreateError('outside-project', `${target} is outside the projects open here and their worktrees`);
    }
    const segments = relative(root, real).split(sep);
    if (segments.includes('.git')) {
        throw new CreateError('git-state', `${target} is part of a repository's own state and is not created from here`);
    }
    if (segments[0] === '.ruimte') {
        throw new CreateError('ruimte-state', `${target} is Ruimte's own state and is not created from here`);
    }
    const bytes = kind === 'file' ? new TextEncoder().encode(payload.text ?? '') : null;
    if (bytes !== null && bytes.length > FS_READ_MAX_TEXT_BYTES) {
        throw new CreateError('too-large', 'That text is too large to create from here');
    }
    try {
        await mkdir(dirname(real), { recursive: true });
        if (bytes === null) {
            await mkdir(real);
            return { size: 0, mtime: Math.round((await lstat(real)).mtimeMs) };
        }
        const handle = await open(real, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
        try {
            await handle.writeFile(bytes);
            const created = await handle.stat();
            return { size: created.size, mtime: Math.round(created.mtimeMs) };
        } finally {
            await handle.close();
        }
    } catch (e) {
        throw failure(e, target);
    }
}
