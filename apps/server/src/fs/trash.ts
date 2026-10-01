import { link, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { CodedError } from '@ruimte/agents/coded-error';

type TrashErrorCode = 'trash-unsupported' | 'trash-failed';

export class TrashError extends CodedError<TrashErrorCode> {}

const exists = (path: string): Promise<boolean> =>
    lstat(path).then(
        () => true,
        () => false
    );

/* `name.ext`, then `name 2.ext`, `name 3.ext`: the first that is free in the trash. */
const freeName = async (name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> => {
    const extension = extname(name);
    const stem = extension === '' ? name : name.slice(0, -extension.length);
    for (let i = 1; ; i++) {
        const candidate = i === 1 ? name : `${stem} ${i}${extension}`;
        if (!(await taken(candidate))) {
            return candidate;
        }
    }
};

/* A rename cannot cross a volume, and a copy-then-delete is not a trash a person can put back from. */
const move = async (from: string, to: string): Promise<void> => {
    try {
        await rename(from, to);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            throw new TrashError('trash-failed', 'The trash is on another volume than this file');
        }
        throw new TrashError('trash-failed', e instanceof Error ? e.message : 'The file could not be moved to the trash');
    }
};

const localIso = (at: Date): string => {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
};

/* The trash of the freedesktop.org spec in the home directory, with the `.trashinfo` a file manager restores from. */
const trashLinux = async (path: string, home: string, env: NodeJS.ProcessEnv): Promise<void> => {
    const root = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'Trash');
    const files = join(root, 'files');
    const info = join(root, 'info');
    await Promise.all([mkdir(files, { recursive: true, mode: 0o700 }), mkdir(info, { recursive: true, mode: 0o700 })]);
    const original = path.split('/').map(encodeURIComponent).join('/');
    const text = `[Trash Info]\nPath=${original}\nDeletionDate=${localIso(new Date())}\n`;
    // The info file claims the name: `link` fails when another trashing took it first.
    const name = await freeName(basename(path), async (candidate) => {
        const claim = join(info, `${candidate}.trashinfo`);
        const draft = `${claim}.${process.pid}`;
        await writeFile(draft, text, { mode: 0o600 });
        try {
            await link(draft, claim);
            return false;
        } catch {
            return true;
        } finally {
            await unlink(draft).catch(() => undefined);
        }
    });
    try {
        await move(path, join(files, name));
    } catch (e) {
        await unlink(join(info, `${name}.trashinfo`)).catch(() => undefined);
        throw e;
    }
};

/*
 * Moves a path to the trash of the machine the daemon runs on, which is a rename into the trash
 * folder: no Finder, no Electron and no permission prompt, since the daemon also runs as a service
 * with neither. Items on another volume than the home folder are refused rather than deleted.
 */
export const trashPath = async (
    path: string,
    platform: NodeJS.Platform = process.platform,
    home: string = homedir(),
    env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
    switch (platform) {
        case 'darwin': {
            const folder = join(home, '.Trash');
            await mkdir(folder, { recursive: true });
            await move(path, join(folder, await freeName(basename(path), (candidate) => exists(join(folder, candidate)))));
            return;
        }
        case 'linux':
            await trashLinux(path, home, env);
            return;
        default:
            throw new TrashError('trash-unsupported', 'This machine has no trash Ruimte can move files to');
    }
};
