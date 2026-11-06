import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { KeyedSerializer } from '@adecore/utils/async';
import { isWithin } from '@adecore/utils/path';
import { FS_READ_MAX_TEXT_BYTES, isRuimteState, type FsWriteResult } from '@ruimte/contracts';
import { realOrNull } from '../disk/real-path.ts';
import { ReadError, UTF8_BOM, inspect } from './read.ts';

type WriteErrorCode = 'stale' | 'too-large' | 'not-text' | 'ruimte-state' | 'not-writable';

class WriteError extends CodedError<WriteErrorCode> {}

class BoundaryError extends CodedError<'outside-project' | 'git-state' | 'ruimte-state'> {}

/* Keyed on dev and inode, so a hard link to a file shares the queue of the file itself. */
const saves = new KeyedSerializer();

/* Where a save from one client may land. */
export interface WriteBoundary {
    // The folders of the projects the client has open.
    folders: string[];
    // Every worktree of the repository a folder is in, as git lists them.
    worktreesOf: (folder: string) => Promise<string[]>;
    // `$RUIMTE_HOME/worktrees`: a worktree counts only when it sits there.
    worktreesRoot: string;
    // The worktrees the daemon made for the repository a folder is in; they count wherever they are, since the worktree folder can change.
    registeredWorktrees?: (folder: string) => Promise<string[]>;
}

/* The boundary as real paths, so neither `..` nor a symlinked folder decides what is inside. */
export async function realRoots(boundary: WriteBoundary): Promise<string[]> {
    const folders = await Promise.all(boundary.folders.map(realOrNull));
    const worktreesRoot = await realOrNull(boundary.worktreesRoot);
    const listed = (await Promise.all(boundary.folders.map(boundary.worktreesOf))).flat();
    const registered = boundary.registeredWorktrees;
    const made = registered ? (await Promise.all(boundary.folders.map((folder) => registered(folder).catch(() => [] as string[])))).flat() : [];
    const madeReal = new Set((await Promise.all(made.map(realOrNull))).filter((path): path is string => path !== null));
    const worktrees = (await Promise.all(listed.map(realOrNull))).filter(
        (path) => path !== null && ((worktreesRoot !== null && isWithin(worktreesRoot, path)) || madeReal.has(path))
    );
    return [...folders, ...worktrees].filter((root): root is string => root !== null);
}

/*
 * The boundary of one folder alone, which has to lie inside `boundary` itself. Without `within` it is
 * `boundary`; with it, no other open project and no worktree counts, as an extension's own project promises.
 */
export async function narrowTo(boundary: WriteBoundary, within: string | undefined): Promise<WriteBoundary> {
    if (within === undefined) {
        return boundary;
    }

    const real = await realOrNull(within);

    if (real === null || !(await realRoots(boundary)).some((root) => isWithin(root, real))) {
        throw new BoundaryError('outside-project', `${within} is outside the projects open here and their worktrees`);
    }

    return { folders: [real], worktreesOf: async () => [], worktreesRoot: boundary.worktreesRoot };
}

/* The real path of an entry; a link keeps its own name, so it is handled as the link and never followed. */
export async function realEntryPath(path: string): Promise<string | null> {
    const entry = await lstat(path).catch(() => null);
    if (entry === null) {
        return null;
    }
    // Anything but a link is named the way the disk spells it, so `.GIT` on a volume that ignores case is `.git`.
    return await (entry.isSymbolicLink() ? realpath(dirname(path)).then((folder) => join(folder, basename(path))) : realpath(path)).catch(() => null);
}

/*
 * Why a request may not touch this path below a project root, or null when it may. Submodules and
 * repositories beside the project carry a `.git` of their own, so any level counts.
 */
export function stateRefusal(segments: readonly string[], path: string, verb: string): { code: 'git-state' | 'ruimte-state'; message: string } | null {
    if (segments.includes('.git')) {
        return { code: 'git-state', message: `${path} is part of a repository's own state and is not ${verb} from here` };
    }
    if (isRuimteState(segments)) {
        return { code: 'ruimte-state', message: `${path} is Ruimte's own state and is not ${verb} from here` };
    }
    return null;
}

/* The root of the boundary a real path lies in; `path` is how the refusal names it. */
export function rootOf(roots: readonly string[], real: string, path: string): string {
    const root = roots.find((candidate) => isWithin(candidate, real));
    if (root === undefined) {
        throw new BoundaryError('outside-project', `${path} is outside the projects open here and their worktrees`);
    }
    return root;
}

/* Throws the `stateRefusal` of a real path below `root`. */
export function assertOpenGround(root: string, real: string, path: string, verb: string): void {
    const refused = stateRefusal(relative(root, real).split(sep), path, verb);
    if (refused !== null) {
        throw new BoundaryError(refused.code, refused.message);
    }
}

/* What opening the file for writing may run into after the checks passed, in the codes a read answers with. */
function openError(e: unknown, path: string): unknown {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
        return new ReadError('not-found', 'That file is not there');
    }
    if (code === 'ELOOP') {
        return new ReadError('not-a-file', 'That path is a symbolic link. Ruimte does not write through links.');
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return new WriteError('not-writable', `${path} cannot be written`);
    }
    return e;
}

/*
 * Opens a file to save over it, never through a link. Windows has no `O_NOFOLLOW`, so there the name is
 * looked at first; a link swapped in after that look opens another inode, which the save refuses as stale.
 */
export async function openForSave(path: string): Promise<FileHandle> {
    const noFollow = constants.O_NOFOLLOW;
    if (noFollow === undefined) {
        if ((await lstat(path)).isSymbolicLink()) {
            throw Object.assign(new Error(`ELOOP: ${path} is a symbolic link`), { code: 'ELOOP' });
        }
        return await open(path, constants.O_WRONLY);
    }
    return await open(path, constants.O_WRONLY | noFollow);
}

/*
 * Saves text over a file `fs.read` answered as text, and only over that: the file has to be there,
 * still be text by the same sniff, and still carry the mtime the read handed out. Written in place,
 * so the inode, its mode and its hard links stay what they were.
 */
export async function writeTextFile(
    path: string,
    text: string,
    expectedMtime: number,
    boundary: WriteBoundary,
    maxBytes: number = FS_READ_MAX_TEXT_BYTES
): Promise<FsWriteResult> {
    const { file, mime, bom } = await inspect(path);
    const folder = await realOrNull(dirname(file.path));
    if (folder === null) {
        throw new ReadError('not-found', 'That file is not there');
    }
    const real = join(folder, basename(file.path));
    const roots = await realRoots(boundary);
    rootOf(roots, real, file.path);
    // The project files move only through `project.save` and its rev; a write here would slip past both.
    if (roots.some((root) => isWithin(root, real) && isRuimteState(relative(root, real).split(sep)))) {
        throw new WriteError('ruimte-state', `${file.path} is Ruimte's own state and is not written from here`);
    }
    if (mime) {
        throw new WriteError('not-text', 'That file is not text. Ruimte does not write over it.');
    }
    const encoded = new TextEncoder().encode(text);
    // The read handed the text out without the mark, and a file that had one keeps it.
    const bytes = bom && !text.startsWith('\uFEFF') ? Buffer.concat([UTF8_BOM, encoded]) : encoded;
    if (bytes.length > maxBytes) {
        throw new WriteError('too-large', 'That text is too large to save from here');
    }
    // An editor outside Ruimte can still race this in-place write; the queue only orders Ruimte's own saves.
    return await saves.run(`${file.dev}:${file.ino}`, async () => {
        const handle = await openForSave(real).catch((e: unknown) => {
            throw openError(e, file.path);
        });
        try {
            const opened = await handle.stat();
            // A different inode means the name was swapped for another file after the checks above.
            if (opened.dev !== file.dev || opened.ino !== file.ino || Math.round(opened.mtimeMs) !== expectedMtime) {
                throw new WriteError('stale', 'That file changed on disk since it was read');
            }
            await handle.writeFile(bytes);
            await handle.truncate(bytes.length);
            let written = await handle.stat();
            // A save inside the millisecond of the read would keep the mtime, and a second save against it would pass as fresh.
            if (Math.round(written.mtimeMs) <= expectedMtime) {
                await handle.utimes(written.atime, new Date(expectedMtime + 1));
                written = await handle.stat();
            }
            return { size: written.size, mtime: Math.round(written.mtimeMs) };
        } finally {
            await handle.close();
        }
    });
}
