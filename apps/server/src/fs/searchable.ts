import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isInside } from '../canvas/project-paths.ts';
import { MAX_FILE_BYTES } from './grep-lines.ts';
import { isMachineStatePath, type MachineHomePolicy } from './machine-home.ts';
import { realOrNull, realOrSelf } from './real-path.ts';

// Windows has neither flag; there the check on the opened file below is all the guard.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/* Where a search runs: the folder as asked for and as it really is, and the home it stays out of. */
export interface SearchRoot {
    cwd: string;
    realCwd: string;
    policy: MachineHomePolicy;
}

export async function searchRoot(cwd: string, policy: MachineHomePolicy): Promise<SearchRoot> {
    const lexical = resolve(cwd);
    return { cwd: lexical, realCwd: await realOrSelf(lexical), policy };
}

/* Whether a listed name may be named at all, judged before anything under it is read. */
export function isOpenName(root: SearchRoot, path: string): boolean {
    return !isMachineStatePath(root.policy, join(root.cwd, path)) && !isMachineStatePath(root.policy, join(root.realCwd, path));
}

/*
 * Whether a listed name may be named, judged on where it leads now as well. A name that no longer
 * leads anywhere fails, so one seen through a folder that was a link for a moment is not handed out.
 */
export async function isOpenPath(root: SearchRoot, path: string): Promise<boolean> {
    if (!isOpenName(root, path)) {
        return false;
    }
    const real = await realOrNull(join(root.cwd, path));
    return real !== null && !isMachineStatePath(root.policy, real);
}

/*
 * The text of a listed file, or null for one a search passes by. The file is opened first and judged
 * after: on the place it really has, inside the folder searched and outside the machine's state, and
 * on being the very file that was opened. A folder above it swapped for a link at any moment fails
 * closed, since the opened file and the one its path leads to now are then two files.
 */
export async function readSearchable(root: SearchRoot, path: string, afterOpen?: () => Promise<void>): Promise<string | null> {
    if (!isOpenName(root, path)) {
        return null;
    }
    const full = join(root.cwd, path);
    const handle = await open(full, OPEN_FLAGS).catch(() => null);
    if (handle === null) {
        return null;
    }
    try {
        await afterOpen?.();
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.size > BigInt(MAX_FILE_BYTES)) {
            return null;
        }
        const real = await realpath(full);
        const there = await stat(real, { bigint: true });
        if (there.dev !== opened.dev || there.ino !== opened.ino || !isInside(root.realCwd, real) || isMachineStatePath(root.policy, real)) {
            return null;
        }
        const prefix = Buffer.alloc(Math.min(1024, Number(opened.size)));
        let offset = 0;
        while (offset < prefix.byteLength) {
            const { bytesRead } = await handle.read({ buffer: prefix, offset, length: prefix.byteLength - offset, position: offset });
            if (bytesRead === 0) {
                break;
            }

            if (prefix.subarray(offset, offset + bytesRead).includes(0)) {
                return null;
            }

            offset += bytesRead;
        }

        const content = await handle.readFile('utf8');
        // Preserve decoded-prefix rejection for Unicode and for content changed after the probe.
        return content.slice(0, 1024).includes('\0') ? null : content;
    } catch {
        return null;
    } finally {
        await handle.close();
    }
}
