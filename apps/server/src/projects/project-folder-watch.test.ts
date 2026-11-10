import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import { ProjectFolderWatch } from './project-folder-watch.ts';

/* The watch builds its paths with `join`, so on Windows they carry backslashes, and the expected ones must too. */
function native(path: string): string {
    return join(path);
}

function setup() {
    const watch = new FakeWatch();
    const heard: string[] = [];
    const folders = new ProjectFolderWatch(watch, (projectId, change) => void heard.push(change === 'files' ? projectId : `${projectId} icon`));

    return { watch, heard, folders };
}

describe('ProjectFolderWatch', () => {
    test('tells which project changed once its burst of writes settled, and ignores any other file', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(
            new Map([
                ['one', native('/work/one')],
                ['two', native('/work/two')]
            ])
        );
        watch.on(native('/work/one/.ruimte')).emit('project.json');
        watch.on(native('/work/one/.ruimte')).emit('project.json');
        watch.on(native('/work/two/.ruimte')).emit('notes.txt');
        await watch.settle();

        expect(heard).toEqual(['one']);
    });

    test('lets go of a project that left the list and keeps the others', () => {
        const { watch, folders } = setup();
        folders.sync(
            new Map([
                ['one', native('/work/one')],
                ['two', native('/work/two')]
            ])
        );
        folders.sync(new Map([['two', native('/work/two')]]));

        expect(watch.openOn(native('/work/one'))).toHaveLength(0);
        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(0);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
        expect(watch.openOn(native('/work/two'))).toHaveLength(1);
        expect(watch.openOn(native('/work/two/.ruimte'))).toHaveLength(1);
        expect(watch.openOn(native('/work/two/.ruimte/private'))).toHaveLength(1);

        folders.close();

        expect(watch.openOn(native('/work/two'))).toHaveLength(0);
        expect(watch.openOn(native('/work/two/.ruimte'))).toHaveLength(0);
        expect(watch.openOn(native('/work/two/.ruimte/private'))).toHaveLength(0);
    });

    test('hears nothing of the project folder itself but its .ruimte folder', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(new Map([['one', native('/work/one')]]));
        watch.on(native('/work/one')).emit('project.json');
        watch.on(native('/work/one')).emit('README.md');
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
                    if (path.includes(native('/.ruimte')) && !ruimteExists) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', native('/work/one')]]));
        const [deadShared] = watch.openOn(native('/work/one/.ruimte'));
        const [deadPrivate] = watch.openOn(native('/work/one/.ruimte/private'));

        ruimteExists = false;
        watch.on(native('/work/one')).emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(0);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
        expect(heard).toEqual(['one']);

        ruimteExists = true;
        watch.on(native('/work/one')).emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte'))[0]).not.toBe(deadShared);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte/private'))[0]).not.toBe(deadPrivate);
        expect(heard).toEqual(['one', 'one']);

        watch.on(native('/work/one/.ruimte')).emit('project.json');
        await watch.settle();
        watch.on(native('/work/one/.ruimte/private')).emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one', 'one', 'one']);

        folders.close();

        expect(watch.openOn(native('/work/one'))).toHaveLength(0);
        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(0);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
    });

    test('watches a .ruimte folder that is made after the watch began', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let ruimteMade = false;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.includes(native('/.ruimte')) && !ruimteMade) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', native('/work/one')]]));

        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(0);

        ruimteMade = true;
        watch.on(native('/work/one')).emit('.ruimte', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on(native('/work/one/.ruimte')).emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);
    });

    test('hears the private file of a project too, and no other file in that folder', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(new Map([['one', native('/work/one')]]));
        watch.on(native('/work/one/.ruimte/private')).emit('notes.txt');
        await watch.settle();

        expect(heard).toEqual([]);

        watch.on(native('/work/one/.ruimte/private')).emit('project.json');
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
                    if (path.endsWith(native('/private')) && !privateMade) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', native('/work/one')]]));

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);

        privateMade = true;
        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);

        watch.on(native('/work/one/.ruimte/private')).emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);

        folders.close();

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
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
                    if (path.endsWith(native('/private'))) {
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
        folders.sync(new Map([['one', native('/work/one')]]));

        expect(opened).toBe(1);

        privateExists = false;
        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);

        privateExists = true;
        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');
        await watch.settle();

        expect(opened).toBe(2);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(heard).toEqual(['one']);

        watch.on(native('/work/one/.ruimte/private')).emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one', 'one']);

        folders.close();

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
    });

    test('tells that the project changed when the private folder was removed and not made again', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let privateExists = true;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.endsWith(native('/private')) && !privateExists) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId) => void heard.push(projectId)
        );
        folders.sync(new Map([['one', native('/work/one')]]));

        privateExists = false;
        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(0);
        expect(heard).toEqual(['one']);
    });

    test('replaces a private watcher that died when the folder was removed and made in one go', () => {
        const { watch, folders } = setup();
        folders.sync(new Map([['one', native('/work/one')]]));
        const [dead] = watch.openOn(native('/work/one/.ruimte/private'));
        watch.on(native('/work/one/.ruimte')).emit('private', 'rename');

        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte/private'))[0]).not.toBe(dead);
    });

    test('watches a project folder that was missing when the watch began once the list is given again', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let folderThere = false;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (!folderThere) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId, change) => void heard.push(`${projectId} ${change}`)
        );
        folders.sync(new Map([['one', native('/work/one')]]));
        folders.sync(new Map([['one', native('/work/one')]]));

        expect(watch.openOn(native('/work/one'))).toHaveLength(0);

        folderThere = true;
        folders.sync(new Map([['one', native('/work/one')]]));
        await watch.settle();

        expect(watch.openOn(native('/work/one'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/public'))).toHaveLength(1);
        expect(heard).toEqual(['one files', 'one icon']);

        folders.sync(new Map([['one', native('/work/one')]]));
        expect(watch.openOn(native('/work/one'))).toHaveLength(1);

        watch.on(native('/work/one/.ruimte')).emit('project.json');
        await watch.settle();

        expect(heard).toEqual(['one files', 'one icon', 'one files']);
    });

    test('lets go of a project folder that was removed and watches it again once its parent hears it come back', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let folderThere = true;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.startsWith(native('/work/one')) && !folderThere) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId, change) => void heard.push(`${projectId} ${change}`)
        );
        folders.sync(new Map([['one', native('/work/one')]]));
        const [dead] = watch.openOn(native('/work/one'));

        folderThere = false;
        watch.on(native('/work')).emit('one', 'rename');

        await watch.settle();

        expect(dead?.closed).toBe(true);
        expect(watch.openOn(native('/work/one'))).toHaveLength(0);
        expect(heard).toEqual(['one files']);

        folderThere = true;
        watch.on(native('/work')).emit('one', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/work/one'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/.ruimte/private'))).toHaveLength(1);
        expect(watch.openOn(native('/work/one/public'))).toHaveLength(1);
        expect(heard).toEqual(['one files', 'one files', 'one icon']);

        watch.on(native('/work')).emit('two', 'rename');
        await watch.settle();

        expect(heard).toEqual(['one files', 'one files', 'one icon']);

        folders.close();

        expect(watch.openOn(native('/work'))).toHaveLength(0);
    });

    test('tells that the project went with a disk that was ejected, and hears it come back from the folder above the disk', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        const failures = new Map<string, () => void>();
        let mounted = true;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.startsWith(native('/Volumes/Disk')) && !mounted) {
                        throw new Error('ENOENT');
                    }

                    const watcher = watch.watch(path, options, listener);

                    return {
                        on: (_event, fail) => {
                            // A watcher that fails is closed by then.
                            failures.set(path, () => {
                                watcher.close();
                                fail(new Error('EIO'));
                            });
                        },
                        close: () => watcher.close()
                    };
                }
            },
            (projectId, change) => void heard.push(`${projectId} ${change}`)
        );
        folders.sync(new Map([['one', native('/Volumes/Disk/one')]]));

        expect(watch.openOn(native('/Volumes/Disk'))).toHaveLength(1);

        mounted = false;
        failures.get(native('/Volumes/Disk/one'))?.();
        failures.get(native('/Volumes/Disk'))?.();
        await watch.settle();

        expect(watch.openOn(native('/Volumes/Disk/one'))).toHaveLength(0);
        expect(watch.openOn(native('/Volumes'))).toHaveLength(1);
        expect(heard).toEqual(['one files']);

        mounted = true;
        watch.on(native('/Volumes')).emit('Disk', 'rename');
        await watch.settle();

        expect(watch.openOn(native('/Volumes/Disk/one'))).toHaveLength(1);
        expect(watch.openOn(native('/Volumes/Disk'))).toHaveLength(1);
        expect(watch.openOn(native('/Volumes'))).toHaveLength(0);
        expect(heard).toEqual(['one files', 'one files', 'one icon']);

        folders.close();
    });

    test('tells that the icon may have changed for the files an icon is derived from, and for no other', async () => {
        const { watch, heard, folders } = setup();
        folders.sync(new Map([['one', native('/work/one')]]));
        watch.on(native('/work/one/.ruimte')).emit('icon.png');
        await watch.settle();
        watch.on(native('/work/one')).emit('favicon.ico');
        await watch.settle();
        watch.on(native('/work/one/src/app')).emit('icon_dark.svg');
        await watch.settle();
        watch.on(native('/work/one/public')).emit('robots.txt');
        watch.on(native('/work/one/.ruimte/private')).emit('icon.png');
        watch.on(native('/work/one')).emit('package.json');
        await watch.settle();

        expect(heard).toEqual(['one icon', 'one icon', 'one icon']);
    });

    test('watches a folder an icon may live in that is made after the watch began', async () => {
        const watch = new FakeWatch();
        const heard: string[] = [];
        let assetsMade = false;
        const folders = new ProjectFolderWatch(
            {
                schedule: watch.schedule,
                watch: (path, options, listener) => {
                    if (path.endsWith(native('/assets')) && !assetsMade) {
                        throw new Error('ENOENT');
                    }

                    return watch.watch(path, options, listener);
                }
            },
            (projectId, change) => void heard.push(`${projectId} ${change}`)
        );
        folders.sync(new Map([['one', native('/work/one')]]));

        expect(watch.openOn(native('/work/one/assets'))).toHaveLength(0);

        assetsMade = true;
        watch.on(native('/work/one')).emit('assets', 'rename');
        await watch.settle();
        watch.on(native('/work/one/assets')).emit('logo.svg');
        await watch.settle();

        expect(watch.openOn(native('/work/one/assets'))).toHaveLength(1);
        expect(heard).toEqual(['one icon', 'one icon']);

        folders.close();

        expect(watch.openOn(native('/work/one/assets'))).toHaveLength(0);
    });
});
