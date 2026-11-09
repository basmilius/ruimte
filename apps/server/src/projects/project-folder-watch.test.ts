import { describe, expect, test } from 'bun:test';
import { FakeWatch } from '@adecore/agents/testing';
import { ProjectFolderWatch } from './project-folder-watch.ts';

function setup() {
    const watch = new FakeWatch();
    const heard: string[] = [];
    const folders = new ProjectFolderWatch(watch, (projectId) => void heard.push(projectId));

    return { watch, heard, folders };
}

describe('ProjectFolderWatch', () => {
    test('tells which project changed once its burst of writes settled, and ignores any other file', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(
            new Map([
                ['one', '/work/one'],
                ['two', '/work/two']
            ])
        );
        watch.on('/work/one/.ruimte').emit('project.json');
        watch.on('/work/one/.ruimte').emit('project.json');
        watch.on('/work/two/.ruimte').emit('notes.txt');
        await watch.settle();

        expect(heard).toEqual(['one']);
    });

    test('lets go of a project that left the list and keeps the others', () => {
        const { watch, folders } = setup();
        folders.sync(
            new Map([
                ['one', '/work/one'],
                ['two', '/work/two']
            ])
        );
        folders.sync(new Map([['two', '/work/two']]));

        expect(watch.openOn('/work/one')).toHaveLength(0);
        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(0);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
        expect(watch.openOn('/work/two')).toHaveLength(1);
        expect(watch.openOn('/work/two/.ruimte')).toHaveLength(1);
        expect(watch.openOn('/work/two/.ruimte/private')).toHaveLength(1);

        folders.close();

        expect(watch.openOn('/work/two')).toHaveLength(0);
        expect(watch.openOn('/work/two/.ruimte')).toHaveLength(0);
        expect(watch.openOn('/work/two/.ruimte/private')).toHaveLength(0);
    });

    test('hears nothing of the project folder itself but its .ruimte folder', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(new Map([['one', '/work/one']]));
        watch.on('/work/one').emit('project.json');
        watch.on('/work/one').emit('README.md');
        await watch.settle();

        expect(heard).toEqual([]);
    });

    test('watches .ruimte and its private folder again after .ruimte was removed and made anew', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let ruimteExists = true;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.includes('/.ruimte') && !ruimteExists) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', '/work/one']]));
        const [deadShared] = watch.openOn('/work/one/.ruimte');
        const [deadPrivate] = watch.openOn('/work/one/.ruimte/private');

        ruimteExists = false;
        watch.on('/work/one').emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(0);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
        expect(heard).toEqual(['one']);

        ruimteExists = true;
        watch.on('/work/one').emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(1);
        expect(watch.openOn('/work/one/.ruimte')[0]).not.toBe(deadShared);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);
        expect(watch.openOn('/work/one/.ruimte/private')[0]).not.toBe(deadPrivate);
        expect(heard).toEqual(['one', 'one']);

        watch.on('/work/one/.ruimte').emit('project.json');
        await watch.settle();
        watch.on('/work/one/.ruimte/private').emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one', 'one', 'one']);

        folders.close();

        expect(watch.openOn('/work/one')).toHaveLength(0);
        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(0);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
    });

    test('watches a .ruimte folder that is made after the watch began', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let ruimteMade = false;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.includes('/.ruimte') && !ruimteMade) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', '/work/one']]));

        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(0);

        ruimteMade = true;
        watch.on('/work/one').emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(1);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on('/work/one/.ruimte').emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);
    });

    test('hears the private file of a project too, and no other file in that folder', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(new Map([['one', '/work/one']]));
        watch.on('/work/one/.ruimte/private').emit('notes.txt');
        await watch.settle();

        expect(heard).toEqual([]);

        watch.on('/work/one/.ruimte/private').emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one']);
    });

    test('watches a private folder that is made after the watch began, and hears the file already in it', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let privateMade = false;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.endsWith('/private') && !privateMade) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', '/work/one']]));

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);

        privateMade = true;
        watch.on('/work/one/.ruimte').emit('private', 'rename');
        await watch.settle();

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on('/work/one/.ruimte').emit('private', 'rename');

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);

        watch.on('/work/one/.ruimte/private').emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);

        folders.close();

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
    });

    test('watches a private folder again after it was removed and made anew', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let privateExists = true;
        let opened = 0;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.endsWith('/private')) {
                        if (!privateExists) {
                            throw new Error('ENOENT');
                        }

                        opened++;
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', '/work/one']]));

        expect(opened).toBe(1);

        privateExists = false;
        watch.on('/work/one/.ruimte').emit('private', 'rename');

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);

        privateExists = true;
        watch.on('/work/one/.ruimte').emit('private', 'rename');
        await watch.settle();

        expect(opened).toBe(2);
        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on('/work/one/.ruimte/private').emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);

        folders.close();

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
    });

    test('tells that the project changed when the private folder was removed and not made again', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let privateExists = true;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.endsWith('/private') && !privateExists) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', '/work/one']]));

        privateExists = false;
        watch.on('/work/one/.ruimte').emit('private', 'rename');
        await watch.settle();

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(0);
        expect(heard).toEqual(['one']);
    });

    test('replaces a private watcher that died when the folder was removed and made in one go', () => {
        const { watch, folders } = setup();
        folders.sync(new Map([['one', '/work/one']]));
        const [dead] = watch.openOn('/work/one/.ruimte/private');
        watch.on('/work/one/.ruimte').emit('private', 'rename');

        expect(watch.openOn('/work/one/.ruimte/private')).toHaveLength(1);
        expect(watch.openOn('/work/one/.ruimte/private')[0]).not.toBe(dead);
    });
});
