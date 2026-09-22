import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_LIST_MAX_ENTRIES } from '@ruimte/contracts';
import { ListError, listDirectory } from './list.ts';

let root: string;
let outside: string;

const names = (entries: { name: string }[]): string[] => entries.map((entry) => entry.name);

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-list-'));
    outside = await mkdtemp(join(tmpdir(), 'ruimte-outside-'));
    await mkdir(join(root, 'src', 'deep'), { recursive: true });
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'item10.txt'), 'ten');
    await writeFile(join(root, 'item2.txt'), 'two');
    await writeFile(join(root, '.env'), 'secret');
    await writeFile(join(root, 'src', 'index.ts'), 'export {};');
    await writeFile(join(root, 'src', 'deep', 'buried.ts'), 'export {};');
    await writeFile(join(outside, 'private.txt'), 'not yours');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
});

describe('listDirectory', () => {
    test('puts directories first and sorts names the way a person reads numbers', async () => {
        const result = await listDirectory(root);
        expect(names(result.entries)).toEqual(['assets', 'src', 'item2.txt', 'item10.txt']);
        expect(result.path).toBe(root);
        expect(result.truncated).toBe(false);
        expect(result.entries[0]!.kind).toBe('directory');
        expect(result.entries[0]!.size).toBeNull();
        expect(result.entries[2]!.size).toBe(3);
    });

    test('outside a repository a dot stays out until it is asked for', async () => {
        expect(names((await listDirectory(root)).entries)).not.toContain('.env');
        const withHidden = await listDirectory(root, { hidden: true });
        expect(names(withHidden.entries)).toContain('.env');
        expect(withHidden.entries.find((entry) => entry.name === '.env')!.hidden).toBe(true);
    });

    test('never lists what the operating system keeps to itself, or Ruimte its own state', async () => {
        await writeFile(join(root, '.DS_Store'), '');
        await mkdir(join(root, '.ruimte'));
        expect(names((await listDirectory(root, { hidden: true })).entries)).not.toContain('.DS_Store');
        expect(names((await listDirectory(root, { hidden: true })).entries)).not.toContain('.ruimte');
    });

    test('build output waits for the hidden flag, with or without a repository', async () => {
        await mkdir(join(root, 'node_modules'));
        await writeFile(join(root, 'node_modules', 'left.js'), '');
        expect(names((await listDirectory(root, { depth: 2 })).entries)).not.toContain('node_modules');
        const withHidden = await listDirectory(root, { depth: 2, hidden: true });
        expect(names(withHidden.entries)).toContain('node_modules');
        // What is only there to be built is never walked into, however deep the listing goes.
        expect(names(withHidden.entries)).not.toContain('left.js');
    });

    test('a deeper listing follows every directory with what is under it', async () => {
        const result = await listDirectory(root, { depth: 2 });
        expect(names(result.entries)).toEqual(['assets', 'src', 'deep', 'index.ts', 'item2.txt', 'item10.txt']);
        // Depth two stops one level short of the file in `src/deep`.
        expect(names(result.entries)).not.toContain('buried.ts');
        expect(names((await listDirectory(root, { depth: 3 })).entries)).toContain('buried.ts');
    });

    test('stays inside the folder it was given: a symlink out is an entry, never a door', async () => {
        await symlink(outside, join(root, 'elsewhere'));
        const result = await listDirectory(root, { depth: 3 });
        expect(result.entries.find((entry) => entry.name === 'elsewhere')!.kind).toBe('symlink');
        expect(names(result.entries)).not.toContain('private.txt');
    });

    test('flags what git ignores, and nothing outside a repository', async () => {
        expect((await listDirectory(root, { hidden: true })).entries.every((entry) => !entry.ignored)).toBe(true);

        await writeFile(join(root, '.gitignore'), 'assets/\n*.txt\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        const result = await listDirectory(root, { hidden: true });
        const ignored = new Set(result.entries.filter((entry) => entry.ignored).map((entry) => entry.name));
        expect(ignored).toEqual(new Set(['assets', 'item2.txt', 'item10.txt']));
        expect(names(result.entries)).not.toContain('.git');
    });

    test('caps a long directory and says so', async () => {
        const wide = join(root, 'wide');
        await mkdir(wide);
        await Promise.all(Array.from({ length: FS_LIST_MAX_ENTRIES + 5 }, (_value, index) => writeFile(join(wide, `f${index}.txt`), '')));
        const result = await listDirectory(wide);
        expect(result.entries).toHaveLength(FS_LIST_MAX_ENTRIES);
        expect(result.truncated).toBe(true);
    });

    test('a dot the repository keeps is listed like any other name', async () => {
        await mkdir(join(root, '.github'));
        await writeFile(join(root, '.editorconfig'), 'root = true\n');
        await writeFile(join(root, '.gitignore'), 'assets/\n.env\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        const listed = names((await listDirectory(root)).entries);
        expect(listed).toContain('.github');
        expect(listed).toContain('.editorconfig');
        expect(listed).not.toContain('.env');
        expect(listed).not.toContain('assets');
        expect(listed).not.toContain('.git');
    });

    test('a checkout under the folder answers about itself, not the one above it', async () => {
        await writeFile(join(root, '.gitignore'), 'notes/\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        const sub = join(root, 'sub');
        await mkdir(join(sub, 'notes'), { recursive: true });
        await writeFile(join(sub, 'notes', 'kept.md'), 'kept');
        await Bun.spawn(['git', 'init', '-q'], { cwd: sub, stdout: 'ignore', stderr: 'ignore' }).exited;
        await mkdir(join(root, 'notes'));
        await writeFile(join(root, 'notes', 'gone.md'), 'gone');

        const result = await listDirectory(root, { depth: 2 });
        expect(names(result.entries)).not.toContain('gone.md');
        expect(result.entries.find((entry) => entry.name === 'notes' && entry.path.startsWith(sub))!.ignored).toBe(false);
    });

    test('answers with a code for what is not a folder', async () => {
        expect(listDirectory(join(root, 'nowhere'))).rejects.toThrow(ListError);
        expect(listDirectory(join(root, 'item2.txt'))).rejects.toThrow('not a folder');
    });
});
