import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discardPaths, stagePaths, unstagePaths } from './stage.ts';
import { forgetBase, readStatus } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

let template: RepoTemplate;
let root: string;
let repo: string;

const git = (args: string[]): Promise<string> => gitIn(repo, args);

const write = (name: string, body: string): Promise<void> => writeFile(join(repo, name), body);

const statesOf = async (): Promise<string[]> => (await readStatus(repo)).files.map((file) => `${file.path} ${file.state}`);

beforeAll(async () => {
    template = await repoTemplate('ruimte-stage', (dir) => initRepo(join(dir, 'repo'), { 'tracked.txt': 'one\n' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    repo = join(root, 'repo');
    forgetBase();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('staging', () => {
    test('a change and an untracked file go into the index and come back out of it', async () => {
        await write('tracked.txt', 'one\ntwo\n');
        await write('fresh.txt', 'new\n');

        await stagePaths(repo, ['tracked.txt', 'fresh.txt']);
        expect(await statesOf()).toEqual(['fresh.txt staged', 'tracked.txt staged']);

        await unstagePaths(repo, ['tracked.txt', 'fresh.txt']);
        expect(await statesOf()).toEqual(['tracked.txt unstaged', 'fresh.txt untracked']);
    });

    test('a file that is gone is staged as the deletion it is', async () => {
        await rm(join(repo, 'tracked.txt'));
        await stagePaths(repo, ['tracked.txt']);
        expect((await readStatus(repo)).files).toMatchObject([{ path: 'tracked.txt', state: 'staged', status: 'D' }]);
    });
});

describe('discarding', () => {
    test('the working tree goes back to HEAD and the work is in a stash of its own', async () => {
        await write('tracked.txt', 'one\ntwo\n');

        const result = await discardPaths(repo, ['tracked.txt']);
        expect(result.stash).toMatch(/^ruimte-discard-/);
        expect(await readFile(join(repo, 'tracked.txt'), 'utf-8')).toBe('one\n');
        expect(await git(['stash', 'list', '--format=%gs'])).toContain(result.stash!);

        // And the stash is a way back, not a copy: popping it returns what was discarded.
        await git(['stash', 'pop']);
        expect(await readFile(join(repo, 'tracked.txt'), 'utf-8')).toBe('one\ntwo\n');
    });

    test('an untracked file goes into the stash too, so nothing is deleted for good', async () => {
        await write('fresh.txt', 'new\n');
        const result = await discardPaths(repo, ['fresh.txt']);
        expect(result.stash).not.toBeNull();
        expect(await statesOf()).toEqual([]);

        await git(['stash', 'pop']);
        expect(await readFile(join(repo, 'fresh.txt'), 'utf-8')).toBe('new\n');
    });

    test('a path with nothing to discard leaves no stash behind', async () => {
        expect(await discardPaths(repo, ['tracked.txt'])).toEqual({ stash: null });
        expect(await git(['stash', 'list'])).toBe('');
    });
});
