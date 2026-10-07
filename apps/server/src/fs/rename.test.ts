import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renamePath } from './rename.ts';
import type { WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;

function boundary(): WriteBoundary {
    return { folders: [project], worktreesOf: async () => [], worktreesRoot: join(root, 'home', 'worktrees') };
}

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
    try {
        await work;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
}

async function exists(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null)) !== null;
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-rename-')));
    project = join(root, 'project');
    outside = join(root, 'outside');
    await mkdir(join(project, 'src'), { recursive: true });
    await Promise.all([mkdir(outside), mkdir(join(project, '.git')), mkdir(join(project, '.ruimte'))]);
    await Promise.all([writeFile(join(project, 'src', 'a.ts'), 'a'), writeFile(join(project, 'src', 'b.ts'), 'b'), writeFile(join(outside, 'c.txt'), 'c')]);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.rename', () => {
    test('renames a file and moves a folder with what is in it', async () => {
        await renamePath(join(project, 'src', 'a.ts'), join(project, 'src', 'z.ts'), boundary());
        expect(await readFile(join(project, 'src', 'z.ts'), 'utf8')).toBe('a');
        await renamePath(join(project, 'src'), join(project, 'lib'), boundary());
        expect(await readFile(join(project, 'lib', 'b.ts'), 'utf8')).toBe('b');
        expect(await exists(join(project, 'src'))).toBe(false);
    });

    test('makes the folders above a new place that are missing', async () => {
        await renamePath(join(project, 'src', 'b.ts'), join(project, 'deep', 'er', 'b.ts'), boundary());
        expect(await readFile(join(project, 'deep', 'er', 'b.ts'), 'utf8')).toBe('b');
    });

    test('never overwrites a name that is taken', async () => {
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary()))).toBe('exists');
        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('b');
    });

    test('refuses what is not there, a relative path and a folder moved into itself', async () => {
        expect(await codeOf(renamePath(join(project, 'nope'), join(project, 'x'), boundary()))).toBe('not-found');
        expect(await codeOf(renamePath('src/a.ts', join(project, 'x'), boundary()))).toBe('bad-path');
        expect(await codeOf(renamePath(join(project, 'src'), join(project, 'src', 'inner'), boundary()))).toBe('into-itself');
    });

    test('stays inside the projects open here, and leaves .git and .ruimte closed', async () => {
        expect(await codeOf(renamePath(join(outside, 'c.txt'), join(project, 'c.txt'), boundary()))).toBe('outside-project');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(outside, 'a.ts'), boundary()))).toBe('outside-project');
        expect(await codeOf(renamePath(join(project, '.git'), join(project, 'git'), boundary()))).toBe('git-state');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, '.git', 'a.ts'), boundary()))).toBe('git-state');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, '.ruimte', 'a.ts'), boundary()))).toBe('ruimte-state');
        expect(await codeOf(renamePath(project, join(project, '..', 'moved'), boundary()))).toBe('outside-project');
    });

    test('moves a console out of the private state and back, since a person owns it', async () => {
        const consoles = join(project, '.ruimte', 'private', 'consoles');
        await renamePath(join(project, 'src', 'a.ts'), join(consoles, 'a.sql'), boundary());
        await renamePath(join(consoles, 'a.sql'), join(project, 'queries', 'a.sql'), boundary());

        expect((await stat(join(project, 'queries', 'a.sql'))).isFile()).toBe(true);
        expect(await codeOf(renamePath(consoles, join(project, 'consoles'), boundary()))).toBe('ruimte-state');
    });

    test('a link out of the project is moved as the link and a target through one is judged on where it lands', async () => {
        await symlink(outside, join(project, 'link'));
        await renamePath(join(project, 'link'), join(project, 'other'), boundary());
        expect((await stat(join(outside, 'c.txt'))).isFile()).toBe(true);
        await symlink(outside, join(project, 'out'));
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, 'out', 'a.ts'), boundary()))).toBe('outside-project');
    });
});
