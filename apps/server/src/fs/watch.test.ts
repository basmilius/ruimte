import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsChangedEvent } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { FolderWatcher } from './watch.ts';

let root: string;
let watcher: FolderWatcher;
let changes: FsChangedEvent[];

const sink = (event: SessionEvent): void => {
    if (event.event === 'fs.changed') {
        changes.push(event.payload);
    }
};

// The settle window plus the slack a loaded machine needs to deliver the event at all.
const nextChange = async (): Promise<FsChangedEvent> => {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (changes.length > 0) {
            return changes.shift()!;
        }
        await Bun.sleep(50);
    }
    throw new Error('No fs.changed arrived');
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-watch-'));
    await mkdir(join(root, 'src'));
    watcher = new FolderWatcher();
    changes = [];
});

afterEach(async () => {
    watcher.detachAll('client-1');
    await rm(root, { recursive: true, force: true });
});

describe('FolderWatcher', () => {
    test('reports the directory a write touched, once per burst', async () => {
        watcher.subscribe('client-1', sink);
        watcher.watch('client-1', root);
        await writeFile(join(root, 'src', 'a.ts'), 'one');
        await writeFile(join(root, 'src', 'b.ts'), 'two');
        const change = await nextChange();
        expect(change.root).toBe(root);
        expect(change.paths).toContain(join(root, 'src'));
        expect(changes).toHaveLength(0);
    });

    test('a client that unwatches hears nothing more', async () => {
        watcher.subscribe('client-1', sink);
        watcher.watch('client-1', root);
        watcher.unwatch('client-1', root);
        await writeFile(join(root, 'src', 'c.ts'), 'three');
        await Bun.sleep(400);
        expect(changes).toHaveLength(0);
    });

    test('a disconnect drops every watch the client had', async () => {
        watcher.subscribe('client-1', sink);
        watcher.watch('client-1', root);
        watcher.watch('client-1', join(root, 'src'));
        watcher.detachAll('client-1');
        await writeFile(join(root, 'src', 'd.ts'), 'four');
        await Bun.sleep(400);
        expect(changes).toHaveLength(0);
    });

    test('a folder that is not there is a watch that never fires, not a throw', () => {
        watcher.subscribe('client-1', sink);
        expect(() => watcher.watch('client-1', join(root, 'nowhere'))).not.toThrow();
    });
});
