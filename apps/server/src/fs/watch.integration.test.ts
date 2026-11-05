import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supportsRecursive, type DirectoryWatcher } from '@adecore/agents';
import type { FsChangedEvent } from '@ruimte/contracts';
import { SharedWatch } from '../disk/shared-watch.ts';
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
        // Where a watch is not recursive, every folder the tree shows is watched on its own.
        const watched = supportsRecursive(process.platform) ? root : join(root, 'src');
        await watcher.watch('client-1', watched);
        await writeFile(join(root, 'src', 'a.ts'), 'one');
        const deadline = Date.now() + DEADLINE_MS;
        while (!changes.some((change) => change.paths.includes(join(root, 'src')))) {
            if (Date.now() > deadline) {
                throw new Error('No fs.changed naming src arrived');
            }
            await Bun.sleep(25);
        }
        expect(changes.every((change) => change.root === watched)).toBe(true);
    },
    DEADLINE_MS + 5_000
);

test(
    'a folder watched under the shared watch hears a write inside it, named from itself',
    async () => {
        const shared = new SharedWatch();
        const outer = new FolderWatcher(process.platform, shared);
        let inner: DirectoryWatcher | undefined;
        const unsubscribe = outer.subscribe('client-2', () => undefined);
        try {
            await outer.watch('client-2', root);
            const names: Array<string | null> = [];
            // Where a tree is one watcher this rides on the outer one, so it has no stream of its own to wait for.
            inner = shared.watch(join(root, 'src'), { recursive: supportsRecursive(process.platform) }, (_event, filename) => names.push(filename));
            await writeFile(join(root, 'src', 'b.ts'), 'two');
            const deadline = Date.now() + DEADLINE_MS;
            while (!names.includes('b.ts')) {
                if (Date.now() > deadline) {
                    throw new Error('No change naming b.ts arrived');
                }
                await Bun.sleep(25);
            }
        } finally {
            inner?.close();
            outer.detachAll('client-2');
            unsubscribe();
        }
    },
    DEADLINE_MS + 5_000
);

test.skipIf(process.platform !== 'darwin')(
    'an earlier child readiness follows a parent that takes over during startup',
    async () => {
        const child = join(root, 'src');
        const nested = join(child, 'nested');
        await mkdir(nested);
        const childReady = watcher.watch('client-1', child);
        await Bun.sleep(50);
        const parentReady = watcher.watch('client-1', root);
        await childReady;
        await writeFile(join(nested, 'handoff.ts'), 'changed during startup');
        await parentReady;
        const deadline = Date.now() + DEADLINE_MS;
        while (!changes.some((change) => change.paths.includes(nested))) {
            if (Date.now() > deadline) {
                throw new Error('The parent handoff lost a change from its ready child');
            }
            await Bun.sleep(25);
        }
    },
    DEADLINE_MS + 5_000
);
