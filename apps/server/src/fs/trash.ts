import { createHash } from 'node:crypto';
import { link, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { CodedError } from '@adecore/agents';
import { RECYCLE_BIN_SOURCE, RecycleBinExit, recycleBinCommand } from './recycle-bin.ts';

type TrashErrorCode = 'trash-unsupported' | 'trash-failed';

export class TrashError extends CodedError<TrashErrorCode> {}

function exists(path: string): Promise<boolean> {
    return lstat(path).then(
        () => true,
        () => false
    );
}

/* `name.ext`, then `name 2.ext`, `name 3.ext`: the first that is free in the trash. */
async function freeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
    const extension = extname(name);
    const stem = extension === '' ? name : name.slice(0, -extension.length);
    for (let i = 1; ; i++) {
        const candidate = i === 1 ? name : `${stem} ${i}${extension}`;
        if (!(await taken(candidate))) {
            return candidate;
        }
    }
}

/* A rename cannot cross a volume, and a copy-then-delete is not a trash a person can put back from. */
async function move(from: string, to: string): Promise<void> {
    try {
        await rename(from, to);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            throw new TrashError('trash-failed', 'The trash is on another volume than this file');
        }
        throw new TrashError('trash-failed', e instanceof Error ? e.message : 'The file could not be moved to the trash');
    }
}

function localIso(at: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/* A started process, as far as the trash needs one; a test hands in its own, so the Windows branch runs on every platform. */
export interface TrashProcess {
    exited: Promise<number>;
    errors: Promise<string>;
    kill(): void;
}

export type SpawnTrash = (command: string[], env: NodeJS.ProcessEnv) => TrashProcess;

export function spawnTrash(command: string[], env: NodeJS.ProcessEnv): TrashProcess {
    const child = Bun.spawn(command, { env, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', windowsHide: true });
    return {
        exited: child.exited,
        errors: new Response(child.stderr).text().catch(() => ''),
        kill: () => child.kill()
    };
}

/* Long enough to compile the helper and count a large folder; a dialog nobody answers would otherwise hold the request for good. */
const RECYCLE_BIN_LIMIT_MS = 30_000;

const RECYCLE_BIN_REFUSALS: Record<number, string> = {
    [RecycleBinExit.notFixed]: 'Only files on a fixed drive of this PC go to the Recycle Bin, so this one was left where it is rather than deleted for good',
    [RecycleBinExit.recycleBinOff]: 'The Recycle Bin of this drive is turned off, so the file was left where it is rather than deleted for good',
    [RecycleBinExit.tooLarge]: 'This is larger than the Recycle Bin of its drive holds, so it was left where it is rather than deleted for good',
    [RecycleBinExit.linkedFolder]: 'A linked folder is not moved to the Recycle Bin, so neither the link nor the folder it points to was touched',
    [RecycleBinExit.inUse]: 'Another program has the file open, so it was not moved to the Recycle Bin',
    [RecycleBinExit.canceled]: 'Moving the file to the Recycle Bin was canceled'
};

const RECYCLE_BIN_VERSION = createHash('sha256').update(RECYCLE_BIN_SOURCE).digest('hex').slice(0, 16);

/* Where the script finds the helper's source and keeps what it compiled from it, named by its version. */
async function recycleBinHelper(env: NodeJS.ProcessEnv): Promise<{ source: string; assembly: string }> {
    const folder = join(env.LOCALAPPDATA || tmpdir(), 'Ruimte', 'recycle-bin');
    const source = join(folder, `recycle-bin-${RECYCLE_BIN_VERSION}.cs`);
    if (!(await exists(source))) {
        await mkdir(folder, { recursive: true });
        const draft = `${source}.${process.pid}`;
        await writeFile(draft, RECYCLE_BIN_SOURCE);
        // Another delete may have put it there first, and be compiling from it.
        await rename(draft, source).catch(async (e: unknown) => {
            await unlink(draft).catch(() => undefined);
            if (!(await exists(source))) {
                throw e;
            }
        });
    }
    return { source, assembly: join(folder, `recycle-bin-${RECYCLE_BIN_VERSION}.dll`) };
}

/* The Recycle Bin keeps its own record of where an item came from, so only the shell may put it there. */
async function trashWindows(path: string, env: NodeJS.ProcessEnv, spawn: SpawnTrash): Promise<void> {
    const helper = await recycleBinHelper(env).catch((e: unknown) => {
        throw new TrashError('trash-failed', e instanceof Error ? e.message : 'The Recycle Bin helper could not be written');
    });
    const child = spawn(recycleBinCommand(), {
        ...env,
        RUIMTE_TRASH_PATH: path,
        RUIMTE_RECYCLE_BIN_SOURCE: helper.source,
        RUIMTE_RECYCLE_BIN_ASSEMBLY: helper.assembly
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RECYCLE_BIN_LIMIT_MS);
    });
    const code = await Promise.race([child.exited, late]);
    clearTimeout(timer);
    if (code === null) {
        // The shell works inside this process, so ending it ends a dialog too; a move that finished just then is not undone.
        child.kill();
        throw new TrashError(
            'trash-failed',
            'Moving the file to the Recycle Bin took longer than 30 seconds and was stopped. Look in the Recycle Bin before you try again'
        );
    }
    if (code === RecycleBinExit.moved) {
        return;
    }
    const refusal = RECYCLE_BIN_REFUSALS[code];
    if (refusal !== undefined) {
        throw new TrashError('trash-failed', refusal);
    }
    throw new TrashError('trash-failed', (await child.errors).trim() || 'The file could not be moved to the Recycle Bin');
}

/* The trash of the freedesktop.org spec in the home directory, with the `.trashinfo` a file manager restores from. */
async function trashLinux(path: string, original: string, home: string, env: NodeJS.ProcessEnv): Promise<void> {
    const root = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'Trash');
    const files = join(root, 'files');
    const info = join(root, 'info');
    await Promise.all([mkdir(files, { recursive: true, mode: 0o700 }), mkdir(info, { recursive: true, mode: 0o700 })]);
    const recorded = original.split('/').map(encodeURIComponent).join('/');
    const text = `[Trash Info]\nPath=${recorded}\nDeletionDate=${localIso(new Date())}\n`;
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
}

/*
 * Moves a path to the trash of the machine the daemon runs on, which is a rename into the trash
 * folder: no Finder, no Electron and no permission prompt, since the daemon also runs as a service
 * with neither. Items on another volume than the home folder are refused rather than deleted, and on
 * Windows whatever the Recycle Bin would not take (`recycle-bin.ts`).
 * `original` is the place a restore returns the file to on Linux (macOS keeps only the file name, since Put Back is Finder's own record), for a file moved aside before it is trashed.
 */
export async function trashPath(
    path: string,
    platform: NodeJS.Platform = process.platform,
    home: string = homedir(),
    env: NodeJS.ProcessEnv = process.env,
    original: string = path,
    spawn: SpawnTrash = spawnTrash
): Promise<void> {
    switch (platform) {
        case 'darwin': {
            const folder = join(home, '.Trash');
            await mkdir(folder, { recursive: true });
            await move(path, join(folder, await freeName(basename(path), (candidate) => exists(join(folder, candidate)))));
            return;
        }
        case 'linux':
            await trashLinux(path, original, home, env);
            return;
        case 'win32':
            await trashWindows(path, env, spawn);
            return;
        default:
            throw new TrashError('trash-unsupported', 'This machine has no trash Ruimte can move files to');
    }
}
