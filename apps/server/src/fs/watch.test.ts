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

// FSEvents on a loaded runner can take seconds, and a pass still ends the moment the change lands.
const DEADLINE_MS = 15_000;

/*
 * The change that names `path`. FSEvents may still report the `mkdir` of the fixture after the watch
 * started, as a flush of its own that names only the root, so a change that does not name `path` is
 * passed over rather than taken for the answer.
 */
const changeNaming = async (path: string): Promise<FsChangedEvent> => {
    const deadline = Date.now() + DEADLINE_MS;
    while (Date.now() < deadline) {
        const change = changes.shift();
        if (change?.paths.includes(path)) {
            return change;
        }
        if (!change) {
            await Bun.sleep(25);
        }
    }
    throw new Error(`No fs.changed naming ${path} arrived`);
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
        await watcher.watch('client-1', root);
        await writeFile(join(root, 'src', 'a.ts'), 'one');
        await writeFile(join(root, 'src', 'b.ts'), 'two');
        const change = await changeNaming(join(root, 'src'));
        expect(change.root).toBe(root);
        expect(changes).toHaveLength(0);
    });

    test('a client that unwatches hears nothing more', async () => {
        watcher.subscribe('client-1', sink);
        void watcher.watch('client-1', root);
        watcher.unwatch('client-1', root);
        await writeFile(join(root, 'src', 'c.ts'), 'three');
        await Bun.sleep(400);
        expect(changes).toHaveLength(0);
    });

    test('a disconnect drops every watch the client had', async () => {
        watcher.subscribe('client-1', sink);
        void watcher.watch('client-1', root);
        void watcher.watch('client-1', join(root, 'src'));
        watcher.detachAll('client-1');
        await writeFile(join(root, 'src', 'd.ts'), 'four');
        await Bun.sleep(400);
        expect(changes).toHaveLength(0);
    });

    test('a folder that is not there is a watch that never fires, not a throw', () => {
        watcher.subscribe('client-1', sink);
        expect(() => void watcher.watch('client-1', join(root, 'nowhere'))).not.toThrow();
    });
});
