import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isWithin } from '@adecore/utils/path';
import { homeFolder } from '@ruimte/service/home';
import { realOrSelf } from '../disk/real-path.ts';

type WorktreeRootCheck = { root: string } | { refusal: 'root-refused' | 'not-a-folder'; message: string };

/* The nearest folder that exists on the way up from a path, with whether it is a folder this process may create in. */
async function nearestFolder(path: string): Promise<{ path: string; writable: boolean } | null> {
    let current = path;
    for (;;) {
        const found = await stat(current).catch(() => null);
        if (found !== null) {
            if (!found.isDirectory()) {
                return null;
            }
            return {
                path: current,
                writable: await access(current, constants.W_OK).then(
                    () => true,
                    () => false
                )
            };
        }
        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

/*
 * Whether a folder may hold the checkouts of every worktree on this machine. Never the root of the disk, the
 * person's home folder or anything of `$RUIMTE_HOME` except its own `worktrees`; it has to be a folder that is
 * writable now or can be made.
 */
export async function checkWorktreeRoot(path: string, home: string, userHome: string = homedir()): Promise<WorktreeRootCheck> {
    if (!isAbsolute(path)) {
        return { refusal: 'root-refused', message: 'The worktree folder has to be an absolute path' };
    }
    const wanted = resolve(path);
    if (wanted === resolve('/')) {
        return { refusal: 'root-refused', message: 'The worktree folder cannot be the root of the disk' };
    }
    const nearest = await nearestFolder(wanted);
    if (nearest === null) {
        return { refusal: 'not-a-folder', message: `${path} is not a folder and cannot be made` };
    }
    // Compared on real paths, so a link into the data folder is not a way around it.
    const real = join(await realOrSelf(nearest.path), wanted.slice(nearest.path.length));
    if (real === (await realOrSelf(userHome))) {
        return { refusal: 'root-refused', message: 'The worktree folder cannot be your home folder' };
    }
    const realHome = await realOrSelf(home);
    if (isWithin(realHome, real) && !isWithin(homeFolder(realHome, 'worktrees'), real)) {
        return { refusal: 'root-refused', message: "The worktree folder cannot be inside Ruimte's own data folder" };
    }
    if (!nearest.writable) {
        return { refusal: 'not-a-folder', message: `${path} cannot be written to` };
    }
    return { root: wanted };
}
