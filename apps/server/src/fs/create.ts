import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, writeFileSync } from 'node:fs';
import { lstat, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { FS_READ_MAX_TEXT_BYTES, type FsCreatePayload, type FsCreateResult } from '@ruimte/contracts';
import { withCreateParent } from './create-parent.ts';
import { realOrNull } from './real-path.ts';
import { assertOpenGround, realRoots, rootOf, type WriteBoundary } from './write.ts';

type CreateErrorCode = 'bad-path' | 'exists' | 'not-a-directory' | 'too-large' | 'not-writable';

class CreateError extends CodedError<CreateErrorCode> {}

/* The deepest place along `from` that `look` finds, and the names below it that it does not; `named` is how a refusal names the path. */
export async function deepestEntry<T>(
    from: string,
    look: (path: string) => Promise<T | null>,
    named = from
): Promise<{ at: string; entry: T; missing: string[] }> {
    const missing: string[] = [];
    let current = from;
    for (;;) {
        const entry = await look(current);
        if (entry !== null) {
            return { at: current, entry, missing };
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new CreateError('bad-path', `${named} has no folder to start from`);
        }
        missing.unshift(basename(current));
        current = parent;
    }
}

/*
 * The real path of the deepest folder that exists along `path`, and the names below it that do not.
 * A link along the way is followed, since that is where the new entry would really land.
 */
export async function deepestExisting(path: string): Promise<{ base: string; missing: string[] }> {
    const { at, missing } = await deepestEntry(path, (place) => lstat(place).catch(() => null));
    const base = await realOrNull(at);
    if (base === null) {
        throw new CreateError('not-a-directory', `${at} is a link that leads nowhere`);
    }
    if (missing.length > 0 && !(await stat(base)).isDirectory()) {
        throw new CreateError('not-a-directory', `${at} is a file, not a folder`);
    }
    return { base, missing };
}

function failure(e: unknown, path: string): unknown {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ELOOP') {
        return new CreateError('exists', `${path} is already there`);
    }
    if (code === 'ENOTDIR') {
        return new CreateError('not-a-directory', `A part of ${path} is a file, not a folder`);
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ESTALE' || code === 'ENOTSUP') {
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
 * `exists` and never overwritten, unless the payload asks to `overwrite` a file with a file.
 */
export async function createEntry(payload: FsCreatePayload, boundary: WriteBoundary): Promise<FsCreateResult> {
    return (await planCreate(payload, boundary)).run();
}

/*
 * Checks a create the way `createEntry` makes it; nothing is made until `run`. `noFollow` is 0 on
 * Windows, which has no `O_NOFOLLOW`.
 */
export async function planCreate(
    payload: FsCreatePayload,
    boundary: WriteBoundary,
    noFollow: number = constants.O_NOFOLLOW ?? 0
): Promise<{ run(): Promise<FsCreateResult> }> {
    const { path, kind } = payload;
    if (!isAbsolute(path) || path.includes('\0')) {
        throw new CreateError('bad-path', 'The path must be absolute');
    }
    const target = resolve(path);
    const taken = await lstat(target).catch(() => null);
    // Only a plain file is replaced, and only by a file: a folder or a link stays what it is.
    const replacing = payload.overwrite === true && kind === 'file' && taken?.isFile() === true;
    if (taken !== null && !replacing) {
        throw new CreateError('exists', `${target} is already there`);
    }
    const { base, missing } = await deepestExisting(target);
    const real = join(base, ...missing);
    const roots = await realRoots(boundary);
    const root = rootOf(roots, real, target);
    assertOpenGround(root, real, target, 'created');
    const rootInfo = await stat(root);
    const parents = relative(root, dirname(real)).split(sep).filter(Boolean);
    const bytes = kind === 'file' ? new TextEncoder().encode(payload.text ?? '') : null;
    if (bytes !== null && bytes.length > FS_READ_MAX_TEXT_BYTES) {
        throw new CreateError('too-large', 'That text is too large to create from here');
    }
    return {
        run: async () => {
            try {
                const entry = await lstat(real).catch(() => null);

                if (entry?.isSymbolicLink()) {
                    throw new CreateError('exists', `${target} changed before it was created`);
                }

                const current = await deepestExisting(real);
                const destination = join(current.base, ...current.missing);
                rootOf(roots, destination, target);
                assertOpenGround(rootOf(await realRoots(boundary), destination, target), destination, target, 'created');

                return withCreateParent(root, rootInfo, parents, (directory) => {
                    if (bytes === null) {
                        const created = directory.mkdir(basename(real));

                        return { size: 0, mtime: Math.round(created.mtimeMs) };
                    }

                    const descriptor = directory.open(
                        basename(real),
                        constants.O_WRONLY | (constants.O_NONBLOCK ?? 0) | (replacing ? 0 : constants.O_CREAT | constants.O_EXCL) | noFollow,
                        payload.mode ?? 0o644
                    );

                    try {
                        if (replacing) {
                            const opened = fstatSync(descriptor);

                            if (opened.ino !== taken.ino || opened.dev !== taken.dev) {
                                throw new CreateError('exists', `${target} changed before it was replaced`);
                            }
                        }

                        if (payload.mode !== undefined) {
                            fchmodSync(descriptor, payload.mode);
                        }

                        if (replacing) {
                            ftruncateSync(descriptor, 0);
                        }

                        writeFileSync(descriptor, bytes);
                        const created = fstatSync(descriptor);

                        return { size: created.size, mtime: Math.round(created.mtimeMs) };
                    } finally {
                        closeSync(descriptor);
                    }
                });
            } catch (e) {
                if (replacing && (e as NodeJS.ErrnoException).code === 'ENOENT') {
                    throw new CreateError('exists', `${target} changed before it was replaced`);
                }
                throw failure(e, target);
            }
        }
    };
}
