import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsChangedEvent } from '@ruimte/contracts';
import { FolderWatcher } from './watch.ts';

// FSEvents on a loaded runner can take seconds, and a pass still ends the moment the change lands.
const DEADLINE_MS = 15_000;

let root: string;
let watcher: FolderWatcher;
let changes: FsChangedEvent[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-watch-'));
    await mkdir(join(root, 'src'));
    watcher = new FolderWatcher();
    changes = [];
    watcher.subscribe('client-1', (event) => {
        if (event.event === 'fs.changed') {
            changes.push(event.payload);
        }
    });
});

afterEach(async () => {
    watcher.detachAll('client-1');
    await rm(root, { recursive: true, force: true });
});

/*
 * The platform's side of the promise `watch` makes: a write the moment it resolves is reported. On
 * macOS that is what the stream start wait is for. FSEvents may still report the `mkdir` of the
 * fixture as a flush that names only the root, so a change that does not name `src` is passed over.
 */
test(
    'a write right after the watch resolves is reported with the directory it touched',
    async () => {
        await watcher.watch('client-1', root);
        await writeFile(join(root, 'src', 'a.ts'), 'one');
        const deadline = Date.now() + DEADLINE_MS;
        while (!changes.some((change) => change.paths.includes(join(root, 'src')))) {
            if (Date.now() > deadline) {
                throw new Error('No fs.changed naming src arrived');
            }
            await Bun.sleep(25);
        }
        expect(changes.every((change) => change.root === root)).toBe(true);
    },
    DEADLINE_MS + 5_000
);
