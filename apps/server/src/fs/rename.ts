import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CodedError } from '@adecore/agents';
import { isWithin } from '@adecore/utils/path';
import { retryingRename } from './busy-retry.ts';
import { deepestEntry } from './create.ts';
import { renameNoReplace } from './no-replace-rename.ts';
import { realOrNull } from './real-path.ts';
import { trashPath } from './trash.ts';
import { assertOpenGround, realEntryPath, realRoots, rootOf, type WriteBoundary } from './write.ts';

type RenameErrorCode =
    | 'bad-path'
    | 'not-found'
    | 'exists'
    | 'into-itself'
    | 'not-a-directory'
    | 'project-root'
    | 'not-writable'
    | 'other-volume'
    | 'unsupported';

class RenameError extends CodedError<RenameErrorCode> {}

async function realSource(path: string): Promise<string> {
    const real = await realEntryPath(path);
    if (real === null) {
        throw new RenameError('not-found', `${path} is not there`);
    }
    return real;
}

/* The real place the folder of a new path will have: the deepest folder that exists along it, with the names below it that do not yet. */
async function realTarget(path: string): Promise<string> {
    const { at, missing } = await deepestEntry(dirname(path), (place) => lstat(place).catch(() => null), path);
    const base = await realOrNull(at);
    if (base === null || !(await stat(base)).isDirectory()) {
        throw new RenameError('not-a-directory', `${at} is not a folder`);
    }
    return join(base, ...missing, basename(path));
}

function failure(e: unknown, path: string, to: string): unknown {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        return new RenameError('exists', `${to} is already there`);
    }
    if (code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS') {
        return new RenameError('unsupported', `${path} cannot be moved here without the risk of replacing what is there`);
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return new RenameError('not-writable', `${path} cannot be moved`);
    }
    if (code === 'EXDEV') {
        return new RenameError('other-volume', `${path} cannot be moved to another volume from here`);
    }
    if (code === 'ENAMETOOLONG' || code === 'EINVAL') {
        return new RenameError('bad-path', `${path} is not a name this machine can store`);
    }
    if (code === 'ENOTDIR' || code === 'EISDIR') {
        return new RenameError('not-a-directory', `A part of ${path} is a file, not a folder`);
    }
    return e;
}

type Rename = (from: string, to: string) => Promise<void>;
type Trash = (path: string, original: string) => Promise<void>;

function sameEntry(left: Stats, right: Stats): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

/*
 * Whether `target` is the name of `source` in another case. Only then is a target the source itself: a hard
 * link of it under another name is a name of its own, which a rename on Windows would fold into the source.
 */
function isCaseVariant(source: string, target: string): boolean {
    return dirname(source) === dirname(target) && basename(source).toLowerCase() === basename(target).toLowerCase();
}

/*
 * A new case of the same name, through a spare name, since a rename that refuses a taken name sees the
 * target taken by the source itself.
 */
async function throughSpareName(source: string, target: string, move: Rename): Promise<void> {
    const spare = join(dirname(source), `.ruimte-rename-${randomUUID()}`);
    await move(source, spare);
    try {
        await move(spare, target);
    } catch (e) {
        await move(spare, source).catch((restoreError: unknown) => {
            console.warn(`Could not put ${source} back; it was left at ${spare}`, restoreError);
        });
        throw e;
    }
}

/* The device of the deepest folder that exists along `path`, which is where a move to it lands. */
async function deviceOfPlace(path: string): Promise<number> {
    return (await deepestEntry(dirname(path), (place) => stat(place).catch(() => null), path)).entry.dev;
}

function trashReplaced(path: string, original: string): Promise<void> {
    return trashPath(path, undefined, undefined, undefined, original);
}

/* A move that passed every check; `run` makes it. */
interface RenamePlan {
    run(): Promise<void>;
}

/*
 * Checks a move of a file or folder of an open project, inside the boundary a save keeps and outside
 * what a delete keeps closed. A taken name is never overwritten, unless `overwrite` replaces a file
 * with a file and the old one goes to the trash. A case-only change is the one case where the target
 * is the source itself. Nothing moves until `run`, so a caller can first do what has to come before.
 */
export async function planRename(
    path: string,
    to: string,
    boundary: WriteBoundary,
    options: { overwrite?: boolean; trash?: Trash; rename?: Rename; deviceOf?: (path: string) => Promise<number> } = {}
): Promise<RenamePlan> {
    if (!isAbsolute(path) || !isAbsolute(to) || path.includes('\0') || to.includes('\0')) {
        throw new RenameError('bad-path', 'Both paths must be absolute');
    }
    const source = await realSource(resolve(path));
    const target = await realTarget(resolve(to));
    const roots = await realRoots(boundary);
    const sourceRoot = rootOf(roots, source, path);
    const targetRoot = rootOf(roots, target, to);
    if (roots.includes(source)) {
        throw new RenameError('project-root', 'A project folder is moved outside Ruimte, not from here');
    }
    assertOpenGround(sourceRoot, source, path, 'moved');
    assertOpenGround(targetRoot, target, to, 'moved');
    // `relative` ignores case on Windows, so a case-only change answers '' there.
    if (relative(source, target) !== '' && isWithin(source, target)) {
        throw new RenameError('into-itself', `${path} cannot be moved into itself`);
    }
    const deviceOf = options.deviceOf ?? deviceOfPlace;
    if ((await deviceOf(source)) !== (await deviceOf(target))) {
        throw new RenameError('other-volume', `${path} cannot be moved to another volume from here`);
    }
    const caseChange = isCaseVariant(source, target);
    const taken = await lstat(target).catch(() => null);
    if (taken !== null) {
        const moving = await lstat(source);
        // Only a plain file replaces a plain file; the trash keeps what it replaced.
        if (!(caseChange && sameEntry(taken, moving)) && (options.overwrite !== true || !taken.isFile() || !moving.isFile())) {
            throw new RenameError('exists', `${to} is already there`);
        }
    }
    // Every move refuses a taken name in the call itself; whatever runs between the plan and `run` (a language server's edits) can fill it.
    const move = options.rename ?? retryingRename(renameNoReplace);
    return {
        run: async () => {
            try {
                await mkdir(dirname(target), { recursive: true });
                const moving = await lstat(source);
                const there = await lstat(target).catch(() => null);
                if (there !== null && caseChange && sameEntry(there, moving)) {
                    if (target !== source) {
                        await throughSpareName(source, target, move);
                    }
                } else if (there !== null && options.overwrite === true && there.isFile() && moving.isFile()) {
                    await replace(source, target, options.trash ?? trashReplaced, move);
                } else {
                    await move(source, target);
                }
            } catch (e) {
                throw failure(e, path, to);
            }
        }
    };
}

/*
 * Moves `source` over the file at `target`. The old file is set aside next to the target first, in a hidden folder
 * that keeps its name for the trash, and comes back when the move fails, so a failed move never leaves it only in the trash.
 */
async function replace(source: string, target: string, trash: Trash, move: Rename): Promise<void> {
    const holder = join(dirname(target), `.ruimte-overwrite-${randomUUID()}`);
    const aside = join(holder, basename(target));
    await mkdir(holder);
    try {
        await move(target, aside);
    } catch (e) {
        await rmdir(holder).catch(() => undefined);
        throw e;
    }
    try {
        await move(source, target);
    } catch (e) {
        // Whatever took the name in between stays, and the old file waits in its hidden folder.
        await move(aside, target).catch((restoreError: unknown) => {
            console.warn(`Could not put ${target} back from ${aside}`, restoreError);
        });
        await rmdir(holder).catch(() => undefined);
        throw e;
    }
    try {
        await trash(aside, target);
        await rmdir(holder);
    } catch (e) {
        // The replaced file stays in its hidden folder: losing it is worse than a leftover.
        console.warn(`Could not trash the file replaced at ${target}; it was left in ${holder}`, e);
    }
}
