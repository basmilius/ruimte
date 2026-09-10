import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discardPaths, stagePaths, unstagePaths } from './stage.ts';
import { forgetBase, readStatus } from './status.ts';

let root: string;
let repo: string;

const git = async (args: string[]): Promise<string> => {
    const proc = Bun.spawn(['git', ...args], {
        cwd: repo,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }
    return stdout;
};

const write = (name: string, body: string): Promise<void> => writeFile(join(repo, name), body);

const statesOf = async (): Promise<string[]> => (await readStatus(repo)).files.map((file) => `${file.path} ${file.state}`);

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-stage-')));
    repo = join(root, 'repo');
    await mkdir(repo);
    await git(['init', '-q', '-b', 'main']);
    await write('tracked.txt', 'one\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
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
