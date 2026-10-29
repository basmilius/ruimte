import { beforeEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { FsChangedEvent } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import { ProjectFileWatcher, type FileChange } from '../language/file-watch.ts';
import { SharedWatch } from './shared-watch.ts';
import { FolderWatcher } from './watch.ts';

// Nothing touches the disk: the fake watch reports whatever a test emits.
const root = resolve('/work/project');

let fake: FakeWatch;
let forgotten: Array<readonly string[]>;

function sharedOn(platform: NodeJS.Platform): SharedWatch {
    return new SharedWatch({ platform, seams: fake, forget: (paths) => forgotten.push(paths) });
}

/* What a listener heard, as `filename` per event. */
function heard(): { names: Array<string | null>; listener: (event: string, filename: string | null) => void } {
    const names: Array<string | null> = [];
    return { names, listener: (_event, filename) => names.push(filename) };
}

beforeEach(() => {
    fake = new FakeWatch();
    forgotten = [];
});

describe('SharedWatch', () => {
    test('watches of one folder share one platform watcher, which closes with the last of them', () => {
        const shared = sharedOn('darwin');
        const first = heard();
        const second = heard();
        const one = shared.watch(root, { recursive: true }, first.listener);
        const two = shared.watch(root, { recursive: true }, second.listener);
        expect(fake.watchers).toHaveLength(1);

        fake.on(root).emit(join('src', 'a.ts'));
        expect(first.names).toEqual([join('src', 'a.ts')]);
        expect(second.names).toEqual([join('src', 'a.ts')]);

        one.close();
        one.close();
        expect(fake.openOn(root)).toHaveLength(1);
        two.close();
        expect(fake.openOn(root)).toEqual([]);
    });

    test('a folder under one watched as a tree rides on it and hears only its own part, named from itself', () => {
        const shared = sharedOn('darwin');
        const nested = join(root, 'packages', 'app');
        shared.watch(root, { recursive: true }, () => undefined);
        const inside = heard();
        shared.watch(nested, { recursive: true }, inside.listener);
        expect(fake.watchers).toHaveLength(1);

        fake.on(root).emit(join('packages', 'app', 'src', 'a.ts'));
        fake.on(root).emit(join('packages', 'other', 'b.ts'));
        fake.on(root).emit(join('packages', 'app'));
        fake.on(root).emit(null);

        expect(inside.names).toEqual([join('src', 'a.ts'), null]);
    });

    test('where a tree costs a watcher per directory, every directory has its own', () => {
        const shared = sharedOn('linux');
        shared.watch(root, { recursive: false }, () => undefined);
        shared.watch(join(root, 'src'), { recursive: false }, () => undefined);

        expect(fake.watchers.map((watcher) => watcher.path)).toEqual([root, join(root, 'src')]);
    });

    test('a folder that cannot be watched throws to the one that asked, as the platform does', () => {
        const shared = new SharedWatch({
            platform: 'darwin',
            seams: {
                watch: () => {
                    throw new Error('ENOENT');
                },
                schedule: fake.schedule
            }
        });

        expect(() => shared.watch(root, { recursive: true }, () => undefined)).toThrow('ENOENT');
    });

    test('a burst tells the caches the directories it touched, once, whoever watched them', async () => {
        const shared = sharedOn('darwin');
        shared.watch(root, { recursive: true }, () => undefined);
        fake.on(root).emit(join('alpha', '.git'));
        fake.on(root).emit(join('alpha', 'README.md'));
        fake.on(root).emit(null);
        await fake.settle();

        expect(forgotten).toEqual([[root, join(root, 'alpha')]]);
    });

    test('the file tree and the language servers of one project hear it through one platform watcher', async () => {
        const shared = sharedOn('darwin');
        const changes: FsChangedEvent[] = [];
        const files = new FolderWatcher('darwin', shared, 0);
        files.subscribe('client-1', (event) => {
            if (event.event === 'fs.changed') {
                changes.push(event.payload);
            }
        });
        const batches: FileChange[][] = [];
        const language = new ProjectFileWatcher({
            folder: root,
            platform: 'darwin',
            seams: shared,
            stat: async () => 'file',
            wants: () => true,
            onChanges: (batch) => batches.push(batch)
        });
        await files.watch('client-1', root);
        expect(fake.watchers).toHaveLength(1);

        fake.on(root).emit(join('src', 'a.ts'));
        await fake.settle();

        expect(changes).toEqual([{ root, paths: [join(root, 'src')], changedPaths: [join(root, 'src', 'a.ts')] }]);
        expect(batches).toEqual([[{ path: join(root, 'src', 'a.ts'), type: 2 }]]);

        language.close();
        files.detachAll('client-1');
        expect(fake.openOn(root)).toEqual([]);
    });
});
