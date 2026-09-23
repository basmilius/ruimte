import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES, type FsWriteResult } from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';
import { CodedError } from '../coded-error.ts';
import { ReadError, inspect } from './read.ts';

type WriteErrorCode = 'stale' | 'too-large' | 'not-text' | 'outside-project' | 'ruimte-state' | 'not-writable';

export class WriteError extends CodedError<WriteErrorCode> {}

/* Where a save from one client may land. */
export interface WriteBoundary {
    // The folders of the projects the client has open.
    folders: string[];
    // Every worktree of the repository a folder is in, as git lists them.
    worktreesOf: (folder: string) => Promise<string[]>;
    // `$RUIMTE_HOME/worktrees`: a worktree counts only when it sits there.
    worktreesRoot: string;
}

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null);

/* The boundary as real paths, so neither `..` nor a symlinked folder decides what is inside. */
const realRoots = async (boundary: WriteBoundary): Promise<string[]> => {
    const folders = await Promise.all(boundary.folders.map(realOrNull));
    const worktreesRoot = await realOrNull(boundary.worktreesRoot);
    const listed = worktreesRoot === null ? [] : (await Promise.all(boundary.folders.map(boundary.worktreesOf))).flat();
    const worktrees = (await Promise.all(listed.map(realOrNull))).filter((path) => path !== null && worktreesRoot !== null && isInside(worktreesRoot, path));
    return [...folders, ...worktrees].filter((root): root is string => root !== null);
};

/* What opening the file for writing may run into after the checks passed, in the codes a read answers with. */
const openError = (e: unknown, path: string): unknown => {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
        return new ReadError('not-found', 'That file is not there');
    }
    if (code === 'ELOOP') {
        return new ReadError('not-a-file', 'That path is a symbolic link. Ruimte does not follow links.');
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return new WriteError('not-writable', `${path} cannot be written`);
    }
    return e;
};

/*
 * Saves text over a file `fs.read` answered as text, and only over that: the file has to be there,
 * still be text by the same sniff, and still carry the mtime the read handed out. Written in place,
 * so the inode, its mode and its hard links stay what they were.
 */
export const writeTextFile = async (path: string, text: string, expectedMtime: number, boundary: WriteBoundary): Promise<FsWriteResult> => {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > FS_READ_MAX_TEXT_BYTES) {
        throw new WriteError('too-large', 'That text is too large to save from here');
    }
    const { file, mime } = await inspect(path);
    const folder = await realOrNull(dirname(file.path));
    if (folder === null) {
        throw new ReadError('not-found', 'That file is not there');
    }
    const real = join(folder, basename(file.path));
    const roots = await realRoots(boundary);
    if (!roots.some((root) => isInside(root, real))) {
        throw new WriteError('outside-project', `${file.path} is outside the projects open here and their worktrees`);
    }
    // The project files move only through `project.save` and its rev; a write here would slip past both.
    if (roots.some((root) => isInside(join(root, '.ruimte'), real))) {
        throw new WriteError('ruimte-state', `${file.path} is Ruimte's own state and is not written from here`);
    }
    if (mime) {
        throw new WriteError('not-text', 'That file is not text. Ruimte does not write over it.');
    }
    const handle = await open(real, constants.O_WRONLY | constants.O_NOFOLLOW).catch((e: unknown) => {
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
        const written = await handle.stat();
        return { size: written.size, mtime: Math.round(written.mtimeMs) };
    } finally {
        await handle.close();
    }
};
