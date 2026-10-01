import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deletePath } from './delete.ts';
import type { WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;
let trashed: string[];

const boundary: () => WriteBoundary = () => ({
    folders: [project],
    worktreesOf: async () => [],
    worktreesRoot: join(root, 'home', 'worktrees')
});

const trash = async (path: string): Promise<void> => {
    trashed.push(path);
};

const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
    try {
        await work;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
};

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-delete-')));
    project = join(root, 'project');
    outside = join(root, 'outside');
    trashed = [];
    await Promise.all([mkdir(join(project, 'src'), { recursive: true }), mkdir(outside)]);
    await Promise.all([mkdir(join(project, '.git')), mkdir(join(project, '.ruimte'))]);
    await Promise.all([writeFile(join(project, 'src', 'a.ts'), 'a'), writeFile(join(outside, 'b.txt'), 'b')]);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.delete', () => {
    test('trashes a file and a folder of the project', async () => {
        await deletePath(join(project, 'src', 'a.ts'), boundary(), trash);
        await deletePath(join(project, 'src'), boundary(), trash);

        expect(trashed).toEqual([join(project, 'src', 'a.ts'), join(project, 'src')]);
    });

    test('refuses a path that is not there', async () => {
        expect(await codeOf(deletePath(join(project, 'nope.ts'), boundary(), trash))).toBe('not-found');
    });

    test('refuses a path outside the projects open', async () => {
        expect(await codeOf(deletePath(join(outside, 'b.txt'), boundary(), trash))).toBe('outside-project');
    });

    test('refuses the project folder itself', async () => {
        expect(await codeOf(deletePath(project, boundary(), trash))).toBe('project-root');
    });

    test('refuses .git at any level and .ruimte at the root', async () => {
        await mkdir(join(project, 'vendor', 'lib', '.git'), { recursive: true });

        expect(await codeOf(deletePath(join(project, '.git'), boundary(), trash))).toBe('git-state');
        expect(await codeOf(deletePath(join(project, 'vendor', 'lib', '.git'), boundary(), trash))).toBe('git-state');
        expect(await codeOf(deletePath(join(project, '.ruimte'), boundary(), trash))).toBe('ruimte-state');
        expect(trashed).toEqual([]);
    });

    test('trashes a link out of the project as the link and not its target', async () => {
        await symlink(outside, join(project, 'out'));

        await deletePath(join(project, 'out'), boundary(), trash);

        expect(trashed).toHaveLength(1);
        expect(trashed).toEqual([join(project, 'out')]);
    });

    test('refuses a path that reaches out of the project through a link', async () => {
        await symlink(outside, join(project, 'out'));

        expect(await codeOf(deletePath(join(project, 'out', 'b.txt'), boundary(), trash))).toBe('outside-project');
    });
});
