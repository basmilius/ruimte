import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECYCLE_BIN_SCRIPT, RecycleBinExit } from './recycle-bin.ts';
import { trashPath, type SpawnTrash } from './trash.ts';

let root: string;
let home: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-fs-trash-'));
    home = join(root, 'home');
    await mkdir(home);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('trashPath on macOS', () => {
    test('moves a file into ~/.Trash', async () => {
        const file = join(root, 'a.txt');
        await writeFile(file, 'a');

        await trashPath(file, 'darwin', home);

        expect(await readFile(join(home, '.Trash', 'a.txt'), 'utf8')).toBe('a');
        expect(await stat(file).catch(() => null)).toBeNull();
    });

    test('keeps the file name of a file that was moved aside, and nothing of the hidden folder it sat in', async () => {
        const aside = join(root, '.ruimte-overwrite-1', 'b.ts');
        await mkdir(join(root, '.ruimte-overwrite-1'));
        await writeFile(aside, 'b');

        await trashPath(aside, 'darwin', home, {}, join(root, 'b.ts'));

        expect(await readdir(join(home, '.Trash'))).toEqual(['b.ts']);
    });

    test('numbers a name the trash already holds, keeping the extension', async () => {
        const first = join(root, 'a.txt');
        const second = join(root, 'sub', 'a.txt');
        await mkdir(join(root, 'sub'));
        await Promise.all([writeFile(first, '1'), writeFile(second, '2')]);

        await trashPath(first, 'darwin', home);
        await trashPath(second, 'darwin', home);

        expect((await readdir(join(home, '.Trash'))).sort()).toEqual(['a 2.txt', 'a.txt']);
        expect(await readFile(join(home, '.Trash', 'a 2.txt'), 'utf8')).toBe('2');
    });

    test('moves a folder with what is in it', async () => {
        const folder = join(root, 'dir');
        await mkdir(folder);
        await writeFile(join(folder, 'inner.txt'), 'x');

        await trashPath(folder, 'darwin', home);

        expect(await readFile(join(home, '.Trash', 'dir', 'inner.txt'), 'utf8')).toBe('x');
    });

    test('moves a symbolic link as the link', async () => {
        const target = join(root, 'target.txt');
        const linked = join(root, 'link.txt');
        await writeFile(target, 't');
        await symlink(target, linked);

        await trashPath(linked, 'darwin', home);

        const trashed = join(home, '.Trash', 'link.txt');
        expect((await lstat(trashed)).isSymbolicLink()).toBe(true);
        expect(await readlink(trashed)).toBe(target);
        expect(await readFile(target, 'utf8')).toBe('t');
        expect(await stat(linked).catch(() => null)).toBeNull();
    });
});

describe('trashPath on Linux', () => {
    test('records the original path given for a file that was moved aside', async () => {
        const aside = join(root, '.ruimte-overwrite-1', 'b.ts');
        const original = join(root, 'b.ts');
        await mkdir(join(root, '.ruimte-overwrite-1'));
        await writeFile(aside, 'b');

        await trashPath(aside, 'linux', home, { XDG_DATA_HOME: join(home, 'data') }, original);

        const info = await readFile(join(home, 'data', 'Trash', 'info', 'b.ts.trashinfo'), 'utf8');
        expect(info).toContain(`Path=${original.split('/').map(encodeURIComponent).join('/')}\n`);
        expect(info).not.toContain('.ruimte-overwrite');
    });

    test('moves into the XDG trash and writes the info file a file manager restores from', async () => {
        const file = join(root, 'my file.txt');
        await writeFile(file, 'a');

        await trashPath(file, 'linux', home, { XDG_DATA_HOME: join(home, 'data') });

        const trash = join(home, 'data', 'Trash');
        expect(await readFile(join(trash, 'files', 'my file.txt'), 'utf8')).toBe('a');
        const info = await readFile(join(trash, 'info', 'my file.txt.trashinfo'), 'utf8');
        expect(info).toContain('[Trash Info]');
        expect(info).toContain(`Path=${file.split('/').map(encodeURIComponent).join('/')}`);
        expect(info).toMatch(/DeletionDate=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\n/);
    });

    test('falls back to ~/.local/share and numbers a taken name', async () => {
        const first = join(root, 'a.txt');
        const second = join(root, 'sub', 'a.txt');
        await mkdir(join(root, 'sub'));
        await Promise.all([writeFile(first, '1'), writeFile(second, '2')]);

        await trashPath(first, 'linux', home, {});
        await trashPath(second, 'linux', home, {});

        const trash = join(home, '.local', 'share', 'Trash');
        expect((await readdir(join(trash, 'files'))).sort()).toEqual(['a 2.txt', 'a.txt']);
        expect((await readdir(join(trash, 'info'))).sort()).toEqual(['a 2.txt.trashinfo', 'a.txt.trashinfo']);
    });
});

describe('trashPath elsewhere', () => {
    test('refuses a platform without a trash it can reach', async () => {
        await expect(trashPath(join(root, 'a'), 'freebsd', home)).rejects.toMatchObject({ code: 'trash-unsupported' });
    });
});

describe('trashPath on Windows', () => {
    const path = String.raw`C:\Users\x\project\it's "a" file.txt`;

    interface Started {
        command: string[];
        env: NodeJS.ProcessEnv;
        killed: number;
    }

    function exitingWith(code: number, errors = ''): { spawn: SpawnTrash; started: Started[] } {
        const started: Started[] = [];
        const spawn: SpawnTrash = (command, env) => {
            const process: Started = { command, env, killed: 0 };
            started.push(process);
            return {
                exited: Promise.resolve(code),
                errors: Promise.resolve(errors),
                kill: () => {
                    process.killed += 1;
                }
            };
        };
        return { spawn, started };
    }

    function scriptOf(command: string[]): string {
        return Buffer.from(command[command.indexOf('-EncodedCommand') + 1] ?? '', 'base64').toString('utf16le');
    }

    test('hands the path to the script through RUIMTE_TRASH_PATH and never in its text', async () => {
        const { spawn, started } = exitingWith(0);

        await trashPath(path, 'win32', home, { PATH: 'C:\\Windows' }, path, spawn);

        expect(started).toHaveLength(1);
        const [{ command, env }] = started as [Started];
        expect(command.slice(0, 3)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive']);
        expect(env).toEqual({ PATH: 'C:\\Windows', RUIMTE_TRASH_PATH: path });
        expect(scriptOf(command)).toBe(RECYCLE_BIN_SCRIPT);
        expect(scriptOf(command)).not.toContain('file.txt');
    });

    test('turns an exit it has no sentence for into trash-failed with what PowerShell wrote', async () => {
        const { spawn } = exitingWith(1, '  Exception calling "Run": Access is denied.\r\n');

        await expect(trashPath(path, 'win32', home, {}, path, spawn)).rejects.toMatchObject({
            code: 'trash-failed',
            message: 'Exception calling "Run": Access is denied.'
        });
    });

    test('says something when PowerShell failed without a word', async () => {
        const { spawn } = exitingWith(RecycleBinExit.shellFailed);

        await expect(trashPath(path, 'win32', home, {}, path, spawn)).rejects.toMatchObject({
            code: 'trash-failed',
            message: 'The file could not be moved to the Recycle Bin'
        });
    });

    test.each([
        ['a drive that is not fixed', RecycleBinExit.notFixed, 'Only files on a fixed drive'],
        ['a drive whose Recycle Bin is off', RecycleBinExit.recycleBinOff, 'turned off'],
        ['an item larger than the Recycle Bin', RecycleBinExit.tooLarge, 'larger than the Recycle Bin'],
        ['a linked folder', RecycleBinExit.linkedFolder, 'linked folder'],
        ['a file another program holds', RecycleBinExit.inUse, 'Another program has the file open']
    ])('refuses %s with trash-failed', async (_case, code, words) => {
        const { spawn } = exitingWith(code, 'ignored');

        const failure = await trashPath(path, 'win32', home, {}, path, spawn).catch((e: unknown) => e);

        expect(failure).toMatchObject({ code: 'trash-failed' });
        expect((failure as Error).message).toContain(words);
    });

    test('decides every refusal before the shell is called, and never through the VB delete', () => {
        const run = RECYCLE_BIN_SCRIPT.slice(RECYCLE_BIN_SCRIPT.indexOf('public static int Run('));
        const shell = run.indexOf('return Recycle(target);');
        expect(shell).toBeGreaterThan(0);
        for (const refusal of ['return NotFixed;', 'return LinkedFolder;', 'return RecycleBinOff;', 'return TooLarge;']) {
            const at = run.indexOf(refusal);
            expect(at).toBeGreaterThan(0);
            expect(at).toBeLessThan(shell);
        }
        expect(RECYCLE_BIN_SCRIPT).toContain('GetDriveTypeW(root) != DriveFixed');
        expect(RECYCLE_BIN_SCRIPT).not.toContain('DeleteDirectory');
        expect(RECYCLE_BIN_SCRIPT).not.toContain('Microsoft.VisualBasic');
    });

    test('asks the shell for no error dialog and for a warning instead of a deletion for good', () => {
        const flags = /operation\.Flags = \(ushort\)\(([^)]*)\);/
            .exec(RECYCLE_BIN_SCRIPT)?.[1]
            ?.split('|')
            .map((flag) => flag.trim());
        expect(flags?.sort()).toEqual(['AllowUndo', 'NoConfirmation', 'NoErrorUi', 'Silent', 'WantNukeWarning']);
        expect(RECYCLE_BIN_SCRIPT).toContain('NoErrorUi = 0x400');
        expect(RECYCLE_BIN_SCRIPT).toContain('WantNukeWarning = 0x4000');
    });

    describe('with a process that never ends', () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        test('ends PowerShell after 30 seconds and fails with trash-failed', async () => {
            jest.useFakeTimers();
            let killed = 0;
            const spawn: SpawnTrash = () => ({
                exited: new Promise<number>(() => undefined),
                errors: new Promise<string>(() => undefined),
                kill: () => {
                    killed += 1;
                }
            });

            const trashing = trashPath(path, 'win32', home, {}, path, spawn).catch((e: unknown) => e);
            jest.advanceTimersByTime(29_999);
            await Promise.resolve();
            expect(killed).toBe(0);
            jest.advanceTimersByTime(1);

            const failure = await trashing;
            expect(failure).toMatchObject({ code: 'trash-failed' });
            expect((failure as Error).message).toContain('did not finish within 30 seconds');
            expect(killed).toBe(1);
        });
    });

    test('leaves the process alone once it exited', async () => {
        const { spawn, started } = exitingWith(0);

        await trashPath(path, 'win32', home, {}, path, spawn);

        expect(started[0]?.killed).toBe(0);
    });
});
