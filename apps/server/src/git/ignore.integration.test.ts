import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { ignoredPaths } from './ignore.ts';
import * as run from './run.ts';
import { gitIn } from './test-repo.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-ignore-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'keep.ts'), '');
    await writeFile(join(root, 'notes.log'), '');
    await writeFile(join(root, 'dist', 'bundle.js'), '');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function ignoreLogsAndDist(): Promise<void> {
    await writeFile(join(root, '.gitignore'), '*.log\ndist/\n');
    await gitIn(root, ['init', '--quiet']);
}

describe('ignoredPaths', () => {
    test('names what the ignore rules match, and nothing outside a repository', async () => {
        const paths = [join(root, 'keep.ts'), join(root, 'notes.log'), join(root, 'dist')];
        expect(await ignoredPaths(paths, root)).toEqual(new Set());

        await ignoreLogsAndDist();
        expect(await ignoredPaths(paths, root)).toEqual(new Set([join(root, 'notes.log'), join(root, 'dist')]));
    });

    test('a repository that ignores nothing answers with an empty set, not a failure', async () => {
        await gitIn(root, ['init', '--quiet']);
        expect(await ignoredPaths([join(root, 'keep.ts')], root)).toEqual(new Set());
    });

    test('no paths asks git nothing', async () => {
        expect(await ignoredPaths([], root)).toEqual(new Set());
    });

    test('preserves absolute and relative names that address the same ignored entry', async () => {
        await ignoreLogsAndDist();
        await writeFile(join(root, 'space name.log'), '');
        const paths = [join(root, 'space name.log'), 'space name.log', `${join(root, 'dist')}${sep}`, `dist${sep}`, join(root, 'keep.ts')];
        expect(await ignoredPaths(paths, root)).toEqual(new Set(paths.slice(0, 4)));
    });

    test('keeps the names of a checkout opened through a directory alias', async () => {
        await ignoreLogsAndDist();
        const holder = await mkdtemp(join(tmpdir(), 'ruimte-ignore-alias-'));
        try {
            const alias = join(holder, 'checkout');
            await symlink(root, alias, 'dir');
            const paths = [join(alias, 'notes.log'), join(alias, 'dist'), join(alias, 'keep.ts')];
            expect(await ignoredPaths(paths, alias)).toEqual(new Set(paths.slice(0, 2)));
            await run.runGit(['add', '-f', '--', 'notes.log'], root);
            expect(await ignoredPaths(paths, alias)).toEqual(new Set([join(alias, 'dist')]));
        } finally {
            await rm(holder, { recursive: true, force: true });
        }
    });

    test.skipIf(process.platform === 'win32')('keeps pathspec-like names and newlines literal through an alias', async () => {
        await ignoreLogsAndDist();
        const names = [':(top)literal.txt', 'line\nbreak.txt', 'space name.txt'];
        await writeFile(join(root, '.gitignore'), ':(top)literal.txt\nline?break.txt\nspace name.txt\n');
        await Promise.all(names.map((name) => writeFile(join(root, name), '')));
        const holder = await mkdtemp(join(tmpdir(), 'ruimte-ignore-literal-'));
        try {
            const alias = join(holder, 'checkout');
            await symlink(root, alias, 'dir');
            const paths = names.map((name) => join(alias, name));
            expect(await ignoredPaths(paths, alias)).toEqual(new Set(paths));
        } finally {
            await rm(holder, { recursive: true, force: true });
        }
    });

    test('counts from a nested cwd and keeps the refusal for a batch that reaches outside the checkout', async () => {
        await ignoreLogsAndDist();
        const nested = join(root, 'nested');
        await mkdir(nested);
        await writeFile(join(nested, 'notes.log'), '');
        const paths = [join(nested, 'notes.log'), 'notes.log'];
        expect(await ignoredPaths(paths, nested)).toEqual(new Set(paths));
        const outside = await mkdtemp(join(tmpdir(), 'ruimte-ignore-outside-'));
        try {
            const other = join(outside, 'notes.log');
            await writeFile(other, '');
            expect(await ignoredPaths([paths[0]!, other], nested)).toEqual(new Set());
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    test('asks git once for what comes in while it runs, and answers each caller its own paths', async () => {
        await ignoreLogsAndDist();
        const runs = spyOn(run, 'runGit');
        try {
            const answers = await Promise.all([
                ignoredPaths([join(root, 'keep.ts')], root),
                ignoredPaths([join(root, 'notes.log')], root),
                ignoredPaths([join(root, 'dist'), join(root, 'keep.ts')], root)
            ]);
            expect(answers).toEqual([new Set(), new Set([join(root, 'notes.log')]), new Set([join(root, 'dist')])]);
            expect(runs).toHaveBeenCalledTimes(1);
        } finally {
            runs.mockRestore();
        }
    });
});
