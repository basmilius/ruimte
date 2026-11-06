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

        expect(watch.openOn('/work/one/.ruimte')).toHaveLength(0);
        expect(watch.openOn('/work/two/.ruimte')).toHaveLength(1);

        folders.close();

        expect(watch.openOn('/work/two/.ruimte')).toHaveLength(0);
    });
});
