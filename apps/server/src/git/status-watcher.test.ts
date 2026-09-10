import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitStatusEvent } from '@ruimte/contracts';
import { GitStatusWatcher } from './status-watcher.ts';
import { forgetBase } from './status.ts';

let root: string;
let repo: string;
let watcher: GitStatusWatcher;
let events: GitStatusEvent[];
let unsubscribe: () => void;

const git = async (args: string[]): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], {
        cwd: repo,
        stdout: 'ignore',
        stderr: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    });
    if ((await proc.exited) !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }
};

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-watch-')));
    repo = join(root, 'repo');
    await mkdir(repo);
    await git(['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'tracked.txt'), 'one\n');
    await writeFile(join(repo, '.gitignore'), 'build/\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    forgetBase();
    events = [];
    watcher = new GitStatusWatcher();
    unsubscribe = watcher.subscribe('c1', (frame) => {
        if (frame.event === 'git.status') {
            events.push(frame.payload);
        }
    });
});

afterEach(async () => {
    watcher.detachAll('c1');
    unsubscribe();
    await rm(root, { recursive: true, force: true });
});

describe('GitStatusWatcher', () => {
    test('a burst of writes is one status, and it names the files that changed', async () => {
        await watcher.watch('c1', repo);
        await Promise.all([writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n'), writeFile(join(repo, 'a.txt'), 'a\n'), writeFile(join(repo, 'b.txt'), 'b\n')]);
        await settle(1200);

        expect(events).toHaveLength(1);
        expect(events[0]!.cwd).toBe(repo);
        expect(events[0]!.status.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt', 'tracked.txt']);
    });

    test('a write git ignores is not worth a status run', async () => {
        await watcher.watch('c1', repo);
        await mkdir(join(repo, 'build'));
        await writeFile(join(repo, 'build', 'out.js'), 'noise\n');
        await settle(1200);

        expect(events).toEqual([]);
    });

    test('an unwatched checkout goes quiet', async () => {
        await watcher.watch('c1', repo);
        watcher.unwatch('c1', repo);
        await writeFile(join(repo, 'a.txt'), 'a\n');
        await settle(1200);

        expect(events).toEqual([]);
    });

    test('a folder outside a repository is nothing to watch', async () => {
        await watcher.watch('c1', root);
        await writeFile(join(root, 'loose.txt'), 'x\n');
        await settle(1200);

        expect(events).toEqual([]);
    });
});
