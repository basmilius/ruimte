import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canvasFixture, type CanvasFixture, content } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('flag', () => {
    test('flags a view and a node, lists them, and takes a flag off with null', async () => {
        expect((await fx.invoke('flag', { id: ['board'], color: 'red' })).lines).toEqual(['flagged\tboard\tview\tred']);
        expect((await fx.invoke('flag', { id: ['note-1'], color: 'blue' })).lines).toEqual(['flagged\tnote-1\tnode\tblue']);
        expect((await fx.invoke('view_list', {})).lines.find((line) => line.startsWith('board\t'))).toBe('board\tcanvas\tBoard\tno\ta person made it\t-\tred');
        expect((await fx.invoke('node_list', {})).lines).toContain('note-1\tnote\tPlan with a tab\t0\t601\t320\t240\t\tblue\t-');
        expect((await fx.invoke('flag', { id: ['board'], color: 'null' })).lines).toEqual(['flagged\tboard\tview\tnull']);
        expect((await fx.onDisk()).flags).toEqual({ 'note-1': 'blue' });
    });

    test('a flag on a shared view or node stays in the private file and leaves the shared one as it was', async () => {
        const opened = await fx.store.openProject({ folder: fx.folder });
        await fx.store.save(fx.projectId, opened.document.rev, content(), ['main']);
        fx.store.release(fx.projectId);
        const sharedPath = join(fx.folder, '.ruimte', 'project.json');
        // The first write through the daemon settles the key order the save above wrote; the flags come after.
        await fx.invoke('flag', { id: ['board'], color: 'red' });
        const before = await readFile(sharedPath, 'utf8');
        await fx.invoke('flag', { id: ['main'], color: 'green' });
        await fx.invoke('flag', { id: ['term-1'], color: 'green' });
        await fx.invoke('flag', { id: ['main'], color: 'null' });
        expect(await readFile(sharedPath, 'utf8')).toBe(before);
        expect(before).not.toContain('green');
        expect(JSON.parse(await readFile(join(fx.folder, '.ruimte', 'private', 'project.json'), 'utf8')).flags).toEqual({ board: 'red', 'term-1': 'green' });
    });

    test('a save that says nothing about flags keeps them, the way a client from before flags saves', async () => {
        await fx.invoke('flag', { id: ['board'], color: 'red' });
        const opened = await fx.store.openProject({ folder: fx.folder });
        const { flags: _flags, version: _version, rev: _rev, shared: _shared, ...older } = opened.document;
        await fx.store.save(fx.projectId, opened.document.rev, older);
        fx.store.release(fx.projectId);
        expect((await fx.onDisk()).flags).toEqual({ board: 'red' });
    });

    test('refuses an id that is no view or node, and a color that is not an accent', async () => {
        const unknown = await fx.invoke('flag', { id: ['nothing'], color: 'red' });
        expect(unknown.status).toBe(422);
        expect(unknown.lines[0]).toBe('refused\tunknown-target\tnothing is not a view or a node of this project');
        const color = await fx.invoke('flag', { id: ['board'], color: 'ultraviolet' });
        expect(color.status).toBe(422);
        expect(color.lines[0]).toStartWith('refused\tbad-arguments\t');
    });
});

describe('several at once', () => {
    const tooMany = (prefix: string): string[] => Array.from({ length: 101 }, (_, i) => `${prefix}-${i}`);

    test('flag puts one color on every id it names in one write, and none when one is no view or node', async () => {
        const { rev, changed } = await fx.watchWrites();
        expect((await fx.invoke('flag', { id: ['board', 'note-1', 'board'], color: 'red' })).lines).toEqual([
            'flagged\tboard\tview\tred',
            'flagged\tnote-1\tnode\tred'
        ]);
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        const refused = await fx.invoke('flag', { id: ['main', 'nothing'], color: 'blue' });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tunknown-target\tnothing is not a view or a node of this project');
        expect((await fx.onDisk()).flags).toEqual({ board: 'red', 'note-1': 'red' });
        expect((await fx.invoke('flag', { id: ['board', 'note-1'], color: 'null' })).lines).toEqual([
            'flagged\tboard\tview\tnull',
            'flagged\tnote-1\tnode\tnull'
        ]);
        expect((await fx.onDisk()).flags ?? {}).toEqual({});
        expect((await fx.invoke('flag', { id: tooMany('view').join(',').split(','), color: 'red' })).lines[0]).toBe(
            'refused\tbad-arguments\tid takes at most 100 ids at once; split the rest over another call'
        );
    });
});
