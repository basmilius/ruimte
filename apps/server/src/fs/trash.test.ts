import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trashPath } from './trash.ts';

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

        expect(await readFile(target, 'utf8')).toBe('t');
        expect(await stat(linked).catch(() => null)).toBeNull();
    });
});

describe('trashPath on Linux', () => {
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
        await expect(trashPath(join(root, 'a'), 'win32', home)).rejects.toMatchObject({ code: 'trash-unsupported' });
    });
});
