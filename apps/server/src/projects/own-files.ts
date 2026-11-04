import { randomBytes } from 'node:crypto';
import { cp, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { entryExists, hasErrorCode, isNotFound } from '@adecore/agents';
import { ChatError } from '../chat/errors.ts';
import { errorText } from '../error-text.ts';
import { renameNoReplace } from '../fs/no-replace-rename.ts';
import { isPathSegment } from '../fs/path-segment.ts';

interface MovedOwnFiles {
    /* The top-level names that arrived in the target. */
    moved: string[];
    /* Puts every name back, last first; a second call does nothing. */
    undo(): Promise<void>;
}

export interface OwnFilesIO {
    /* Moves one path without replacing anything; fails with `EEXIST` when the target is taken. */
    rename(from: string, to: string): Promise<void>;
    /* Copies a file or folder to a name that is free, leaving nothing at `to` when it fails; fails with `EEXIST` when `to` is taken. */
    copy(from: string, to: string): Promise<void>;
    /* Deletes a file or folder with what is in it; the file system's `rm` when absent. */
    remove?(path: string): Promise<void>;
}

type CopyTree = (from: string, to: string) => Promise<void>;

const removeTree = (path: string): Promise<void> => rm(path, { recursive: true, force: true });

const copyTree: CopyTree = (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, preserveTimestamps: true });

/*
 * Copies into a sibling of the target and moves that into place without replacing, so a name that
 * appears while the copy runs is never written into or over, and a failed copy leaves nothing at `to`.
 */
export async function copyWithoutReplacing(from: string, to: string, copy: CopyTree = copyTree, rename = renameNoReplace): Promise<void> {
    const temporary = join(dirname(to), `.${basename(to)}.ruimte-copy-${randomBytes(4).toString('hex')}`);
    try {
        await copy(from, temporary);
        await rename(temporary, to);
    } catch (e) {
        await removeTree(temporary).catch(() => undefined);
        throw e;
    }
}

const SYSTEM_IO: OwnFilesIO = { rename: renameNoReplace, copy: (from, to) => copyWithoutReplacing(from, to) };

/* What a file manager leaves in a folder on its own: not the chat's, so it is neither counted nor moved. */
export const IGNORED_OWN_NAMES: readonly string[] = ['.DS_Store'];

/* The folder a chat in Chats keeps its own files in; an id that is not one name never becomes a path. */
export function ownFolderOf(scratchFolder: string, chatId: string): string {
    if (!isPathSegment(chatId)) {
        throw new ChatError('chat-not-found', `${chatId} is not a chat id`);
    }
    return join(scratchFolder, chatId);
}

function isTaken(error: unknown): boolean {
    return hasErrorCode(error, 'EEXIST', 'ERR_FS_CP_EEXIST');
}

/* One entry back to where it came from: a rename, else (another volume) a copy and then the delete. */
async function moveBack(io: OwnFilesIO, from: string, to: string): Promise<void> {
    try {
        await io.rename(from, to);
    } catch (e) {
        if (!hasErrorCode(e, 'EXDEV')) {
            throw e;
        }
        await io.copy(from, to);
        await removeTree(from);
    }
}

/*
 * Moves the top-level entries of a chat's own folder, hidden ones included, into another folder
 * without replacing anything. A name already there refuses with `files-conflict` before the first
 * entry moves. Across a volume the entries are copied first and the originals deleted only after
 * every copy succeeded; a failed copy removes only what this call made. The emptied `from` goes with
 * `rmdir`, never recursively.
 */
export async function moveOwnFiles(from: string, to: string, io: OwnFilesIO = SYSTEM_IO): Promise<MovedOwnFiles> {
    const listed = await readdir(from).catch((e: unknown) => {
        if (isNotFound(e)) {
            return [];
        }
        throw new ChatError('move-failed', `The folder ${from} could not be read: ${errorText(e)}`);
    });
    const names = listed.filter((name) => !IGNORED_OWN_NAMES.includes(name)).sort();
    for (const name of names) {
        if (await entryExists(join(to, name))) {
            throw new ChatError('files-conflict', `${name} is already in ${to}`);
        }
    }

    const arrived: string[] = [];
    let removedFolder = false;
    let undone = false;
    const undo = async (): Promise<void> => {
        if (undone) {
            return;
        }
        undone = true;
        let failure: unknown = null;
        if (removedFolder) {
            await mkdir(from, { recursive: true }).catch((e: unknown) => (failure ??= e));
        }
        for (const name of arrived.toReversed()) {
            try {
                await moveBack(io, join(to, name), join(from, name));
            } catch (e) {
                failure ??= e;
            }
        }
        if (failure !== null) {
            throw new ChatError('move-failed', `The files could not be put back in ${from}: ${errorText(failure)}`);
        }
    };

    const failed = async (e: unknown, name: string, detail = ''): Promise<never> => {
        await undo().catch(() => undefined);
        if (isTaken(e)) {
            throw new ChatError('files-conflict', `${name} is already in ${to}`);
        }
        throw new ChatError('move-failed', `${name} could not be moved to ${to}: ${errorText(e)}${detail}`);
    };

    let crossing = names.length;
    for (const [i, name] of names.entries()) {
        try {
            await io.rename(join(from, name), join(to, name));
            arrived.push(name);
        } catch (e) {
            if (!hasErrorCode(e, 'EXDEV')) {
                return failed(e, name);
            }
            crossing = i;
            break;
        }
    }

    const remove = io.remove ?? removeTree;
    const copied: string[] = [];
    for (const name of names.slice(crossing)) {
        try {
            await io.copy(join(from, name), join(to, name));
            copied.push(name);
        } catch (e) {
            // The copy that failed left nothing at its name; the ones before it are ours to take back.
            for (const made of copied) {
                await removeTree(join(to, made)).catch(() => undefined);
            }
            return failed(e, name);
        }
    }
    for (const [i, name] of copied.entries()) {
        try {
            await remove(join(from, name));
        } catch (e) {
            // The originals before this one are gone and come back from their copies; those after it are still whole, and so is the copy of this one.
            arrived.push(...copied.slice(0, i));
            for (const later of copied.slice(i + 1)) {
                await removeTree(join(to, later)).catch(() => undefined);
            }
            return failed(e, name, `. The whole copy is in ${join(to, name)}; the original in ${from} may be incomplete.`);
        }
    }
    arrived.push(...copied);

    // Left in the folder it would keep `rmdir` from removing it; it was never the chat's.
    for (const name of listed.filter((entry) => IGNORED_OWN_NAMES.includes(entry))) {
        await rm(join(from, name), { force: true }).catch(() => undefined);
    }
    removedFolder = await rmdir(from).then(
        () => true,
        () => false
    );
    return { moved: names, undo };
}
