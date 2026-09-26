import { beforeEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { FsChangedEvent } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { FolderWatcher } from './watch.ts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';

// Nothing touches the disk: the fake watch reports whatever a test emits.
const root = resolve('/work/repo');

let fake: FakeWatch;
let changes: FsChangedEvent[];

const sink = (event: SessionEvent): void => {
    if (event.event === 'fs.changed') {
        changes.push(event.payload);
    }
};

/* A watcher on a platform that watches a tree in one call, or on one that watches a directory at a time. */
const watcherOn = (platform: NodeJS.Platform): FolderWatcher => {
    const watcher = new FolderWatcher(platform, fake, 0);
    watcher.subscribe('client-1', sink);
    return watcher;
};

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
