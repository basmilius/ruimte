import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browseDirectories, resolveBrowsePath } from './browse.ts';
import { revealCommand } from './reveal.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-browse-'));
    await mkdir(join(root, 'apps'));
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, '.git'));
    await mkdir(join(root, '.config'));
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(root, 'apps', 'server', '.ruimte'), { recursive: true });
    await writeFile(join(root, 'apps', 'server', '.ruimte', 'project.json'), '{}');
    await writeFile(join(root, 'README.md'), '');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('resolveBrowsePath', () => {
    test('expands the home tilde, resolves relative paths against cwd, and refuses what it cannot', () => {
        expect(resolveBrowsePath('~/x', undefined, { home: '/home/me', platform: 'linux' })).toBe('/home/me/x');
        expect(resolveBrowsePath('~', undefined, { home: '/home/me', platform: 'linux' })).toBe('/home/me');
        expect(resolveBrowsePath('./a', '/repo', { platform: 'linux' })).toBe('/repo/a');
        expect(() => resolveBrowsePath('../a', undefined, { platform: 'linux' })).toThrow('open project');
        expect(() => resolveBrowsePath('C:\\Users', undefined, { platform: 'darwin' })).toThrow('Windows path');
        expect(resolveBrowsePath('/abs/x', undefined, { platform: 'linux' })).toBe('/abs/x');
    });
});

describe('browseDirectories', () => {
    test('a path ending in a separator lists directories only, hidden ones left out, canvases marked', async () => {
        const result = await browseDirectories(`${root}/`, undefined, { platform: 'linux' });
        expect(result.parentPath).toBe(root);
        expect(result.entries.map((entry) => entry.name)).toEqual(['apps', 'assets']);
        const server = await browseDirectories(`${root}/apps/`, undefined, { platform: 'linux' });
        expect(server.entries).toEqual([{ name: 'server', fullPath: join(root, 'apps', 'server'), hasCanvas: true }]);
    });

    test('a trailing segment filters its parent by prefix, and a dot prefix shows hidden folders', async () => {
        expect((await browseDirectories(`${root}/as`, undefined)).entries.map((entry) => entry.name)).toEqual(['assets']);
        expect((await browseDirectories(`${root}/.c`, undefined)).entries.map((entry) => entry.name)).toEqual(['.config']);
        expect((await browseDirectories(`${root}/zzz`, undefined)).entries).toEqual([]);
    });

    test('a directory that does not exist lists as empty and says it is not there', async () => {
        const result = await browseDirectories(join(root, 'missing') + '/', undefined);
        expect(result).toEqual({ parentPath: join(root, 'missing'), entries: [], exists: false });
    });

    test('a directory that cannot be read lists as empty, but says it is there', async () => {
        const locked = join(root, 'locked');
        await mkdir(locked, { mode: 0o000 });
        try {
            // Root reads a folder nobody else may, and then there is no unreadable folder to test.
            const denied = await readdir(locked).then(
                () => false,
                () => true
            );
            if (denied) {
                expect(await browseDirectories(`${locked}/`, undefined)).toEqual({ parentPath: locked, entries: [], exists: true });
            }
        } finally {
            await chmod(locked, 0o700);
        }
    });

    test('the hidden flag shows dot-folders without a dot having been typed', async () => {
        expect((await browseDirectories(`${root}/`, undefined, { hidden: true })).entries.map((entry) => entry.name)).toEqual([
            '.config',
            'apps',
            'assets',
            'node_modules'
        ]);
        expect((await browseDirectories(`${root}/`, undefined, { hidden: false })).entries.map((entry) => entry.name)).toEqual(['apps', 'assets']);
    });

    test("a checkout's own directory is never offered, however it is typed", async () => {
        expect((await browseDirectories(`${root}/.g`, undefined)).entries).toEqual([]);
        expect((await browseDirectories(`${root}/`, undefined, { hidden: true })).entries.map((entry) => entry.name)).not.toContain('.git');
    });
});

describe('revealCommand', () => {
    test('per platform, folders open and files are selected', () => {
        expect(revealCommand('/a/b', true, 'darwin')).toEqual(['open', '/a/b']);
        expect(revealCommand('/a/b.txt', false, 'darwin')).toEqual(['open', '-R', '/a/b.txt']);
        expect(revealCommand('C:\\a', true, 'win32')).toEqual(['explorer', 'C:\\a']);
        expect(revealCommand('/a/b.txt', false, 'linux')).toEqual(['xdg-open', '/a']);
    });
});
