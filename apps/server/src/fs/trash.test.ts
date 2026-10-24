import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { RECYCLE_BIN_SCRIPT, RECYCLE_BIN_SOURCE, RecycleBinExit } from './recycle-bin.ts';
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

    function trashing(spawn: SpawnTrash, env: NodeJS.ProcessEnv = { LOCALAPPDATA: root }): Promise<unknown> {
        return trashPath(path, 'win32', home, env, path, spawn).then(
            () => null,
            (e: unknown) => e
        );
    }

    test('hands the path to the script through RUIMTE_TRASH_PATH and never in its text', async () => {
        const { spawn, started } = exitingWith(0);

        expect(await trashing(spawn, { LOCALAPPDATA: root, PATH: 'C:\\Windows' })).toBeNull();

        expect(started).toHaveLength(1);
        const [{ command, env }] = started as [Started];
        expect(command.slice(0, 3)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive']);
        expect(env).toMatchObject({ LOCALAPPDATA: root, PATH: 'C:\\Windows', RUIMTE_TRASH_PATH: path });
        expect(scriptOf(command)).toBe(RECYCLE_BIN_SCRIPT);
        expect(scriptOf(command)).not.toContain('file.txt');
    });

    test('writes the helper once under LocalAppData, named by its version, for the script to compile and keep', async () => {
        const { spawn, started } = exitingWith(0);

        await trashing(spawn);
        await trashing(spawn);

        const folder = join(root, 'Ruimte', 'recycle-bin');
        const [source, assembly] = [started[0]?.env.RUIMTE_RECYCLE_BIN_SOURCE ?? '', started[0]?.env.RUIMTE_RECYCLE_BIN_ASSEMBLY ?? ''];
        expect(source).toMatch(/recycle-bin-[0-9a-f]{16}\.cs$/);
        expect(assembly).toBe(source.replace(/\.cs$/, '.dll'));
        expect(await readdir(folder)).toEqual([basename(source)]);
        expect(await readFile(source, 'utf8')).toBe(RECYCLE_BIN_SOURCE);
        expect(started[1]?.env.RUIMTE_RECYCLE_BIN_ASSEMBLY).toBe(assembly);
    });

    test('fails with trash-failed and starts nothing when the helper cannot be written', async () => {
        const blocked = join(root, 'blocked');
        await writeFile(blocked, '');
        const { spawn, started } = exitingWith(0);

        expect(await trashing(spawn, { LOCALAPPDATA: blocked })).toMatchObject({ code: 'trash-failed' });
        expect(started).toHaveLength(0);
    });

    test('turns an exit it has no sentence for into trash-failed with what PowerShell wrote', async () => {
        const { spawn } = exitingWith(1, '  Access is denied.\r\n');

        expect(await trashing(spawn)).toMatchObject({ code: 'trash-failed', message: 'Access is denied.' });
    });

    test('says something when PowerShell failed without a word', async () => {
        const { spawn } = exitingWith(RecycleBinExit.shellFailed);

        expect(await trashing(spawn)).toMatchObject({ code: 'trash-failed', message: 'The file could not be moved to the Recycle Bin' });
    });

    test.each([
        ['a drive that is not fixed', RecycleBinExit.notFixed, 'Only files on a fixed drive'],
        ['a drive whose Recycle Bin is off', RecycleBinExit.recycleBinOff, 'turned off'],
        ['an item larger than the Recycle Bin', RecycleBinExit.tooLarge, 'larger than the Recycle Bin'],
        ['a linked folder', RecycleBinExit.linkedFolder, 'linked folder'],
        ['a file another program holds', RecycleBinExit.inUse, 'Another program has the file open'],
        ['a move the shell was told not to make', RecycleBinExit.canceled, 'canceled']
    ])('refuses %s with trash-failed', async (_case, code, words) => {
        const { spawn } = exitingWith(code, 'ignored');

        const failure = await trashing(spawn);

        expect(failure).toMatchObject({ code: 'trash-failed' });
        expect((failure as Error).message).toContain(words);
    });

    test('decides every refusal before the shell is called, and never through the VB delete', () => {
        const run = RECYCLE_BIN_SOURCE.slice(RECYCLE_BIN_SOURCE.indexOf('public static int Run('));
        const shell = run.indexOf('return Recycle(target);');
        expect(shell).toBeGreaterThan(0);
        for (const refusal of ['return NotFixed;', 'return LinkedFolder;', 'return RecycleBinOff;', 'return TooLarge;']) {
            const at = run.indexOf(refusal);
            expect(at).toBeGreaterThan(0);
            expect(at).toBeLessThan(shell);
        }
        expect(RECYCLE_BIN_SOURCE).toContain('GetDriveTypeW(root) != DriveFixed');
        expect(`${RECYCLE_BIN_SOURCE}${RECYCLE_BIN_SCRIPT}`).not.toContain('DeleteDirectory');
        expect(`${RECYCLE_BIN_SOURCE}${RECYCLE_BIN_SCRIPT}`).not.toContain('Microsoft.VisualBasic');
    });

    test('asks the shell for no error dialog and for a warning instead of a deletion for good', () => {
        const flags = /operation\.Flags = \(ushort\)\(([^)]*)\);/
            .exec(RECYCLE_BIN_SOURCE)?.[1]
            ?.split('|')
            .map((flag) => flag.trim());
        expect(flags?.sort()).toEqual(['AllowUndo', 'NoConfirmation', 'NoErrorUi', 'Silent', 'WantNukeWarning']);
        expect(RECYCLE_BIN_SOURCE).toContain('NoErrorUi = 0x400');
        expect(RECYCLE_BIN_SOURCE).toContain('WantNukeWarning = 0x4000');
    });

    describe('with a process that never ends', () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        test('ends PowerShell after 30 seconds and fails with trash-failed', async () => {
            jest.useFakeTimers();
            let killed = 0;
            let started: () => void = () => undefined;
            const spawning = new Promise<void>((resolve) => {
                started = resolve;
            });
            const spawn: SpawnTrash = () => {
                started();
                return {
                    exited: new Promise<number>(() => undefined),
                    errors: new Promise<string>(() => undefined),
                    kill: () => {
                        killed += 1;
                    }
                };
            };

            const failure = trashing(spawn);
            await spawning;
            jest.advanceTimersByTime(29_999);
            await Promise.resolve();
            expect(killed).toBe(0);
            jest.advanceTimersByTime(1);

            expect(await failure).toMatchObject({
                code: 'trash-failed',
                message: 'Moving the file to the Recycle Bin took longer than 30 seconds and was stopped. Look in the Recycle Bin before you try again'
            });
            expect(killed).toBe(1);
        });
    });

    test('leaves the process alone once it exited', async () => {
        const { spawn, started } = exitingWith(0);

        await trashing(spawn);

        expect(started[0]?.killed).toBe(0);
    });
});
