import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitChangedEvent, GitStatusEvent } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import { SharedWatch } from '../fs/shared-watch.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { GitStatusWatcher } from './status-watcher.ts';
import { forgetBase, readStatus } from './status.ts';
import * as runner from './run.ts';
import { initRepo } from './test-repo.ts';

let root: string;
let repo: string;
let fake: FakeWatch;
let watcher: GitStatusWatcher;
let events: GitStatusEvent[];
let changed: GitChangedEvent[];
let unsubscribe: () => void;
let clock: number;
let runTakes: number;
let runs: number;
/* While set, a status run waits for it after reading, standing in for a run that is slow to come back. */
let hold: (() => Promise<void>) | null;

/* A watcher whose status runs take as long as `runMs` says, whatever the machine is doing. */
function watcherWith(runMs: number): GitStatusWatcher {
    runTakes = runMs;
    const next = new GitStatusWatcher(
        'darwin',
        fake,
        () => clock,
        async (cwd) => {
            runs += 1;
            const status = await readStatus(cwd);
            await hold?.();
            clock += runTakes;
            return status;
        }
    );
    unsubscribe = next.subscribe('c1', (frame) => {
        if (frame.event === 'git.status') {
            events.push(frame.payload);
        }
        if (frame.event === 'git.changed') {
            changed.push(frame.payload);
        }
    });
    return next;
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-watch-')));
    repo = join(root, 'repo');
    await initRepo(repo, { 'tracked.txt': 'one\n', '.gitignore': 'build/\n' });
    forgetBase();
    clock = 0;
    runs = 0;
    hold = null;
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
    test('two watches of one checkout asked at once keep one watcher', async () => {
        await Promise.all([watcher.watch('c1', repo), watcher.watch('c1', repo)]);
        expect(fake.openOn(repo)).toHaveLength(1);

        watcher.detachAll('c1');
        expect(fake.openOn(repo)).toHaveLength(0);
    });

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
        expect(changed).toEqual([{ cwd: repo, changedPaths: ['a.txt', 'b.txt', 'tracked.txt'].map((path) => join(repo, path)) }]);
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

    test('a write that lands while a status runs is published once that run is over', async () => {
        await watcher.watch('c1', repo);
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();
        const { promise: inside, resolve: entered } = Promise.withResolvers<void>();
        hold = async () => {
            hold = null;
            entered();
            await gate;
        };
        await writeFile(join(repo, 'a.txt'), 'a\n');
        fake.on(repo).emit('a.txt');
        const firstRun = fake.settle();
        await inside;
        await writeFile(join(repo, 'b.txt'), 'b\n');
        fake.on(repo).emit('b.txt');
        const secondRun = fake.settle();
        release();
        await Promise.all([firstRun, secondRun]);

        expect(runs).toBe(2);
        expect(
            events
                .at(-1)!
                .status.files.map((file) => file.path)
                .sort()
        ).toEqual(['a.txt', 'b.txt']);
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
        expect(runs).toBe(0);
        expect(changed).toEqual([]);
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

    test('a status run slower than the limit gives the watch up while runs stay slow', async () => {
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

    test('a fast run after a slow one opens the watch again', async () => {
        unsubscribe();
        watcher = watcherWith(1500);
        await watcher.watch('c1', repo);
        fake.on(repo).emit('tracked.txt');
        await fake.settle();
        expect(fake.openOn(repo)).toEqual([]);

        runTakes = 10;
        expect((await watcher.status(repo)).live).toBe(true);
        expect(fake.openOn(repo)).toHaveLength(1);
    });

    test('a slow root is watched again by a watch asked once a few minutes passed', async () => {
        unsubscribe();
        watcher = watcherWith(1500);
        await watcher.watch('c1', repo);
        fake.on(repo).emit('tracked.txt');
        await fake.settle();
        watcher.unwatch('c1', repo);

        await watcher.watch('c1', repo);
        expect(fake.openOn(repo)).toEqual([]);
        watcher.unwatch('c1', repo);

        clock += 5 * 60 * 1000;
        await watcher.watch('c1', repo);
        expect(fake.openOn(repo)).toHaveLength(1);
    });

    test('two clients of one repository share its watcher and one status run per burst, each under its own folder', async () => {
        const nested = join(repo, 'nested');
        await mkdir(nested);
        const second: Array<{ event: string; cwd: string }> = [];
        const unsubscribeSecond = watcher.subscribe('c2', (frame) => {
            if (frame.event === 'git.status' || frame.event === 'git.changed') {
                second.push({ event: frame.event, cwd: frame.payload.cwd });
            }
        });
        await watcher.watch('c1', repo);
        await watcher.watch('c2', nested);
        expect(fake.watchers).toHaveLength(1);

        await writeFile(join(repo, 'a.txt'), 'a\n');
        fake.on(repo).emit('a.txt');
        await fake.settle();

        expect(runs).toBe(1);
        expect(events.map((event) => event.cwd)).toEqual([repo]);
        expect(second).toEqual([
            { event: 'git.status', cwd: nested },
            { event: 'git.changed', cwd: nested }
        ]);

        watcher.detachAll('c1');
        expect(fake.openOn(repo)).toHaveLength(1);
        watcher.detachAll('c2');
        expect(fake.openOn(repo)).toEqual([]);
        unsubscribeSecond();
    });

    test('statuses asked while one runs share the one run after it', async () => {
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();
        const { promise: inside, resolve: entered } = Promise.withResolvers<void>();
        hold = async () => {
            hold = null;
            entered();
            await gate;
        };
        const first = watcher.status(repo);
        await inside;
        const lookups = spyOn(runner, 'repositoryRoot');
        try {
            const asked = [watcher.status(repo), watcher.status(repo), watcher.status(repo)];
            expect(lookups).toHaveBeenCalledTimes(3);
            // Each status attached its continuation before this barrier, so all three queued while the first read is held.
            await Promise.all(lookups.mock.results.map((result) => result.value));
            expect(runs).toBe(1);
            await writeFile(join(repo, 'latest.txt'), 'latest\n');
            release();
            const [before, ...after] = await Promise.all([first, ...asked]);
            expect(before!.files).toEqual([]);
            expect(after.map((status) => status.files.map((file) => file.path))).toEqual([['latest.txt'], ['latest.txt'], ['latest.txt']]);
            expect(runs).toBe(2);
        } finally {
            release();
            await first;
            lookups.mockRestore();
        }
    });

    test('a repository inside a folder the file tree watches rides on its platform watcher', async () => {
        const shared = new SharedWatch({ platform: 'darwin', seams: fake, forget: () => undefined });
        const files = new FolderWatcher('darwin', shared, 0);
        unsubscribe();
        watcher = new GitStatusWatcher('darwin', shared, () => clock, readStatus);
        unsubscribe = watcher.subscribe('c1', (frame) => {
            if (frame.event === 'git.status') {
                events.push(frame.payload);
            }
        });
        await files.watch('c1', root);
        await watcher.watch('c1', repo);
        expect(fake.watchers).toHaveLength(1);

        await writeFile(join(repo, 'a.txt'), 'a\n');
        fake.on(root).emit(join('repo', 'a.txt'));
        await fake.settle();

        expect(events.map((event) => event.status.files.map((file) => file.path))).toEqual([['a.txt']]);
        files.detachAll('c1');
    });

    test('a status asked by hand that differs from the last one reaches every client watching', async () => {
        await watcher.watch('c1', repo);
        await writeFile(join(repo, 'a.txt'), 'a\n');
        await watcher.status(repo);

        expect(events.map((event) => event.status.files.map((file) => file.path))).toEqual([['a.txt']]);
    });
});

test.each([null, '.git/index', '.git/refs/heads/main'])('a metadata or unnamed change %s invalidates every file', async (name) => {
    await watcher.watch('c1', repo);
    fake.on(repo).emit('tracked.txt');
    fake.on(repo).emit(name);
    await fake.settle();
    expect(changed).toEqual([{ cwd: repo }]);
});

test.each(['bun.lock', 'Cargo.lock', 'src/objects/item.ts', 'notes~'])('working-tree path %s survives mixed and standalone bursts', async (path) => {
    await watcher.watch('c1', repo);
    fake.on(repo).emit('tracked.txt');
    fake.on(repo).emit(path);
    await fake.settle();
    expect(changed).toEqual([{ cwd: repo, changedPaths: [join(repo, path), join(repo, 'tracked.txt')].sort() }]);

    changed.length = 0;
    fake.on(repo).emit(path);
    await fake.settle();
    expect(changed).toEqual([{ cwd: repo, changedPaths: [join(repo, path)] }]);
});
