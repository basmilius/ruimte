import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES } from '@ruimte/contracts';
import { createEntry } from './create.ts';
import type { WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;

function boundary(): WriteBoundary {
    return {
        folders: [project],
        worktreesOf: async () => [],
        worktreesRoot: join(root, 'home', 'worktrees')
    };
}

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
    try {
        await work;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-create-')));
    project = join(root, 'project');
    outside = join(root, 'outside');
    await Promise.all([mkdir(join(project, 'src'), { recursive: true }), mkdir(outside)]);
    await Promise.all([mkdir(join(project, '.git')), mkdir(join(project, '.ruimte'))]);
    await writeFile(join(project, 'src', 'a.ts'), 'a');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.create', () => {
    test('creates an empty file and answers its size and mtime', async () => {
        const path = join(project, 'src', 'b.ts');

        const result = await createEntry({ path, kind: 'file' }, boundary());

        expect(await readFile(path, 'utf8')).toBe('');
        expect(result).toEqual({ size: 0, mtime: Math.round((await stat(path)).mtimeMs) });
    });

    test('starts a file with the text it was given', async () => {
        const path = join(project, 'notes.md');

        const result = await createEntry({ path, kind: 'file', text: '# café\n' }, boundary());

        expect(await readFile(path, 'utf8')).toBe('# café\n');
        expect(result.size).toBe(Buffer.byteLength('# café\n'));
    });

    test('creates a folder', async () => {
        const path = join(project, 'lib');

        await createEntry({ path, kind: 'directory' }, boundary());

        expect((await stat(path)).isDirectory()).toBe(true);
    });

    test('creates the folders above that are missing', async () => {
        await createEntry({ path: join(project, 'a', 'b', 'c.txt'), kind: 'file' }, boundary());
        await createEntry({ path: join(project, 'x', 'y'), kind: 'directory' }, boundary());

        expect((await stat(join(project, 'a', 'b', 'c.txt'))).isFile()).toBe(true);
        expect((await stat(join(project, 'x', 'y'))).isDirectory()).toBe(true);
    });

    test('refuses a name that is there and leaves it alone', async () => {
        const path = join(project, 'src', 'a.ts');

        expect(await codeOf(createEntry({ path, kind: 'file', text: 'new' }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'src'), kind: 'directory' }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'src'), kind: 'file' }, boundary()))).toBe('exists');
        expect(await readFile(path, 'utf8')).toBe('a');
    });

    test('refuses a link that leads nowhere as a name that is taken', async () => {
        await symlink(join(outside, 'nope'), join(project, 'dangling'));

        expect(await codeOf(createEntry({ path: join(project, 'dangling'), kind: 'file' }, boundary()))).toBe('exists');
    });

    test('refuses a folder that would sit below a file', async () => {
        expect(await codeOf(createEntry({ path: join(project, 'src', 'a.ts', 'b'), kind: 'file' }, boundary()))).toBe('not-a-directory');
    });

    test('refuses a path outside the projects open', async () => {
        expect(await codeOf(createEntry({ path: join(outside, 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await codeOf(createEntry({ path: join(project, '..', 'outside', 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await stat(join(outside, 'b.txt')).catch(() => null)).toBeNull();
    });

    test('refuses a path that reaches out of the project through a link, creating nothing', async () => {
        await symlink(outside, join(project, 'out'));

        expect(await codeOf(createEntry({ path: join(project, 'out', 'deep', 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await stat(join(outside, 'deep')).catch(() => null)).toBeNull();
    });

    test('refuses .git at any level and .ruimte at the root', async () => {
        await mkdir(join(project, 'vendor', 'lib', '.git'), { recursive: true });

        expect(await codeOf(createEntry({ path: join(project, '.git', 'hooks', 'pre-commit'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, 'vendor', 'lib', '.git', 'x'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, 'new', '.git', 'x'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'project.json'), kind: 'file' }, boundary()))).toBe('ruimte-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'sub', 'x'), kind: 'directory' }, boundary()))).toBe('ruimte-state');
    });

    test('refuses a relative path and a NUL', async () => {
        expect(await codeOf(createEntry({ path: 'src/b.ts', kind: 'file' }, boundary()))).toBe('bad-path');
        expect(await codeOf(createEntry({ path: join(project, 'a\0b'), kind: 'file' }, boundary()))).toBe('bad-path');
    });

    test('refuses a text past the limit', async () => {
        const text = 'x'.repeat(FS_READ_MAX_TEXT_BYTES + 1);

        expect(await codeOf(createEntry({ path: join(project, 'big.txt'), kind: 'file', text }, boundary()))).toBe('too-large');
        expect(await stat(join(project, 'big.txt')).catch(() => null)).toBeNull();
    });
});
