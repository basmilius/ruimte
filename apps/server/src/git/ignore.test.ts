import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ignoredPaths } from './ignore.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-ignore-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'keep.ts'), '');
    await writeFile(join(root, 'notes.log'), '');
    await writeFile(join(root, 'dist', 'bundle.js'), '');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('ignoredPaths', () => {
    test('names what the ignore rules match, and nothing outside a repository', async () => {
        const paths = [join(root, 'keep.ts'), join(root, 'notes.log'), join(root, 'dist')];
        expect(await ignoredPaths(paths, root)).toEqual(new Set());

        await writeFile(join(root, '.gitignore'), '*.log\ndist/\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        expect(await ignoredPaths(paths, root)).toEqual(new Set([join(root, 'notes.log'), join(root, 'dist')]));
    });

    test('a repository that ignores nothing answers with an empty set, not a failure', async () => {
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        expect(await ignoredPaths([join(root, 'keep.ts')], root)).toEqual(new Set());
    });

    test('no paths asks git nothing', async () => {
        expect(await ignoredPaths([], root)).toEqual(new Set());
    });
});
