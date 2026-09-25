import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitChangedEvent, GitStatusEvent } from '@ruimte/contracts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import { GitStatusWatcher } from './status-watcher.ts';
import { forgetBase } from './status.ts';
import { gitIn } from './test-repo.ts';

let root: string;
let repo: string;
let fake: FakeWatch;
let watcher: GitStatusWatcher;
let events: GitStatusEvent[];
let changed: GitChangedEvent[];
let unsubscribe: () => void;

const git = async (args: string[]): Promise<void> => {
    await gitIn(repo, args);
};

/* A watcher whose status runs take as long as `runMs` says, whatever the machine is doing. */
const watcherWith = (runMs: number): GitStatusWatcher => {
    let clock = 0;
    const next = new GitStatusWatcher('darwin', fake, () => {
        const now = clock;
        clock += runMs;
        return now;
    });
    unsubscribe = next.subscribe('c1', (frame) => {
        if (frame.event === 'git.status') {
            events.push(frame.payload);
        }
        if (frame.event === 'git.changed') {
            changed.push(frame.payload);
        }
    });
    return next;
};

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
    changed = [];
    fake = new FakeWatch();
    watcher = watcherWith(0);
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
        for (const name of ['tracked.txt', 'a.txt', 'b.txt']) {
            fake.on(repo).emit(name);
        }
        expect(fake.pending).toBe(1);
        await fake.settle();

        expect(events).toHaveLength(1);
        expect(events[0]!.cwd).toBe(repo);
        expect(events[0]!.status.live).toBe(true);
        expect(events[0]!.status.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt', 'tracked.txt']);
    });

    test('a status that did not change is not sent again', async () => {
        await watcher.watch('c1', repo);
        await writeFile(join(repo, 'a.txt'), 'a\n');
        fake.on(repo).emit('a.txt');
        await fake.settle();
        fake.on(repo).emit('a.txt');
        await fake.settle();

        expect(events).toHaveLength(1);
    });

    test('a burst the status slept through is still reported as a change', async () => {
        await watcher.watch('c1', repo);
        await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\n');
        fake.on(repo).emit('tracked.txt');
        await fake.settle();
        // The same file again: every word of the status reads the same, the bytes of its diff do not.
        await writeFile(join(repo, 'tracked.txt'), 'one\nthree\n');
        fake.on(repo).emit('tracked.txt');
        await fake.settle();

        expect(events).toHaveLength(1);
        expect(changed.map((event) => event.cwd)).toEqual([repo, repo]);
    });

    test('a write git ignores, and git moving its own objects and locks, are not worth a status run', async () => {
        await watcher.watch('c1', repo);
        await mkdir(join(repo, 'build'));
        await writeFile(join(repo, 'build', 'out.js'), 'noise\n');
        fake.on(repo).emit(join('build', 'out.js'));
        fake.on(repo).emit(join('.git', 'objects', 'ab', 'cdef'));
        fake.on(repo).emit(join('.git', 'index.lock'));
        await fake.settle();

        expect(events).toEqual([]);
    });

    test('an unwatched checkout goes quiet', async () => {
        await watcher.watch('c1', repo);
        fake.on(repo).emit('a.txt');
        watcher.unwatch('c1', repo);

        expect(fake.pending).toBe(0);
        expect(fake.openOn(repo)).toEqual([]);
    });

    test('a folder outside a repository is nothing to watch', async () => {
        await watcher.watch('c1', root);

        expect(fake.watchers).toEqual([]);
    });

    test('a status run slower than the limit gives the watch up for good', async () => {
        unsubscribe();
        watcher = watcherWith(1500);
        await watcher.watch('c1', repo);
        await writeFile(join(repo, 'a.txt'), 'a\n');
        fake.on(repo).emit('a.txt');
        await fake.settle();

        expect(events).toHaveLength(1);
        expect(events[0]!.status.live).toBe(false);
        expect(fake.openOn(repo)).toEqual([]);
        expect((await watcher.status(repo)).live).toBe(false);
    });
});
