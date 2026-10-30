import { beforeEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { FsChangedEvent } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import type { SessionEvent } from '../sessions/manager.ts';
import { FolderWatcher, MAX_CHANGED_PATHS } from './watch.ts';

// Nothing touches the disk: the fake watch reports whatever a test emits.
const root = resolve('/work/repo');

let fake: FakeWatch;
let changes: FsChangedEvent[];

function sink(event: SessionEvent): void {
    if (event.event === 'fs.changed') {
        changes.push(event.payload);
    }
}

/* A watcher on a platform that watches a tree in one call, or on one that watches a directory at a time. */
function watcherOn(platform: NodeJS.Platform): FolderWatcher {
    const watcher = new FolderWatcher(platform, fake, 0);
    watcher.subscribe('client-1', sink);
    return watcher;
}

beforeEach(() => {
    fake = new FakeWatch();
    changes = [];
});

describe('FolderWatcher', () => {
    test('reports the directory a write touched, once per burst', async () => {
        const watcher = watcherOn('darwin');
        await watcher.watch('client-1', root);
        fake.on(root).emit(join('src', 'a.ts'));
        fake.on(root).emit(join('src', 'b.ts'));
        expect(fake.pending).toBe(1);
        expect(changes).toEqual([]);

        await fake.settle();
        expect(changes).toEqual([{ root, paths: [join(root, 'src')], changedPaths: [join(root, 'src', 'a.ts'), join(root, 'src', 'b.ts')] }]);
    });

    test('a burst past the limit names only its directories', async () => {
        const watcher = watcherOn('darwin');
        await watcher.watch('client-1', root);
        for (let i = 0; i <= MAX_CHANGED_PATHS; i++) {
            fake.on(root).emit(join('src', `${i}.ts`));
        }

        await fake.settle();
        expect(changes).toEqual([{ root, paths: [join(root, 'src')] }]);
    });

    test('a change without a name reports the root', async () => {
        const watcher = watcherOn('darwin');
        await watcher.watch('client-1', root);
        fake.on(root).emit(null);
        await fake.settle();
        expect(changes).toEqual([{ root, paths: [root] }]);
    });

    test('a client that unwatches hears nothing more', async () => {
        const watcher = watcherOn('darwin');
        await watcher.watch('client-1', root);
        fake.on(root).emit('c.ts');
        watcher.unwatch('client-1', root);
        expect(fake.pending).toBe(0);
        expect(fake.openOn(root)).toEqual([]);
    });

    test('a disconnect drops every watch the client had', async () => {
        const watcher = watcherOn('linux');
        await watcher.watch('client-1', root);
        await watcher.watch('client-1', join(root, 'src'));
        expect(fake.watchers.map((watch) => watch.recursive)).toEqual([false, false]);
        fake.on(join(root, 'src')).emit('d.ts');

        watcher.detachAll('client-1');
        expect(fake.pending).toBe(0);
        expect(fake.watchers.every((watch) => watch.closed)).toBe(true);
    });

    test('a second watch of the same folder opens no second watcher, so nothing outlives the client', async () => {
        const watcher = watcherOn('linux');
        await watcher.watch('client-1', root);
        await watcher.watch('client-1', root);
        expect(fake.openOn(root)).toHaveLength(1);

        watcher.detachAll('client-1');
        expect(fake.openOn(root)).toHaveLength(0);
    });

    test('a recursive watch covers the folders under it, whichever came first', async () => {
        const watcher = watcherOn('darwin');
        await watcher.watch('client-1', join(root, 'src'));
        await watcher.watch('client-1', root);
        expect(fake.openOn(join(root, 'src'))).toEqual([]);

        await watcher.watch('client-1', join(root, 'lib'));
        expect(fake.watchers.map((watch) => watch.path)).toEqual([join(root, 'src'), root]);
    });

    test('a folder that cannot be watched is a watch that never fires, not a throw', async () => {
        const watcher = new FolderWatcher('darwin', {
            watch: () => {
                throw new Error('ENOENT');
            },
            schedule: fake.schedule
        });
        await expect(watcher.watch('client-1', join(root, 'nowhere'))).resolves.toBeUndefined();
    });
});

describe('watch startup handoff', () => {
    test('joining a pending watch waits for the same readiness barrier', async () => {
        const watcher = new FolderWatcher('darwin', fake, 100);
        try {
            const first = watcher.watch('client-1', root);
            const joined = watcher.watch('client-1', join(root, 'src'));
            let ready = false;
            void joined.then(() => {
                ready = true;
            });
            await Promise.resolve();
            expect(ready).toBe(false);
            await fake.settle();
            await Promise.all([first, joined]);
            expect(ready).toBe(true);
        } finally {
            watcher.detachAll('client-1');
        }
    });

    test('a pending child follows its parent barrier and transfers queued changes', async () => {
        const starts: Array<() => unknown> = [];
        const watcher = new FolderWatcher(
            'darwin',
            {
                watch: fake.watch,
                schedule(callback, ms) {
                    if (ms === 100) {
                        starts.push(callback);
                        return () => undefined;
                    }
                    return fake.schedule(callback, ms);
                }
            },
            100
        );
        watcher.subscribe('client-1', sink);
        try {
            const child = join(root, 'src');
            const childReady = watcher.watch('client-1', child);
            fake.on(child).emit('a.ts');
            const parentReady = watcher.watch('client-1', root);
            expect(fake.openOn(child)).toHaveLength(0);
            let readable = false;
            void childReady.then(() => {
                readable = true;
            });
            starts[0]!();
            await Promise.resolve();
            expect(readable).toBe(false);
            starts[1]!();
            await Promise.all([childReady, parentReady]);
            expect(readable).toBe(true);
            await fake.settle();
            expect(changes).toEqual([{ root, paths: [child], changedPaths: [join(child, 'a.ts')] }]);
        } finally {
            watcher.detachAll('client-1');
        }
    });

    test('a cancelled readiness barrier leaves a replacement registration alone', async () => {
        const starts: Array<() => unknown> = [];
        const watcher = new FolderWatcher(
            'darwin',
            {
                watch: fake.watch,
                schedule(callback, ms) {
                    if (ms === 100) {
                        starts.push(callback);
                        return () => undefined;
                    }
                    return fake.schedule(callback, ms);
                }
            },
            100
        );
        try {
            const first = watcher.watch('client-1', root);
            watcher.unwatch('client-1', root);
            const next = watcher.watch('client-1', root);
            const handle = fake.on(root);
            starts[0]!();
            await first;
            expect(handle.closed).toBe(false);
            starts[1]!();
            await next;
            expect(fake.openOn(root)).toEqual([handle]);
        } finally {
            watcher.detachAll('client-1');
        }
    });
});

test('an unnamed change makes a mixed burst broad, including across watch replacement', async () => {
    const watcher = watcherOn('darwin');
    const child = join(root, 'src');
    await watcher.watch('client-1', child);
    fake.on(child).emit(null);
    await watcher.watch('client-1', root);
    fake.on(root).emit('other.txt');
    await fake.settle();
    expect(changes).toEqual([{ root, paths: [root, child] }]);

    fake.on(root).emit(join('src', 'a.ts'));
    await fake.settle();
    expect(changes[1]?.changedPaths).toEqual([join(child, 'a.ts')]);
    watcher.detachAll('client-1');
});
