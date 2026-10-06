import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DrawingContent, DrawingElement, ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import type { SessionEvent } from '../sessions/manager.ts';
import { DrawingStore } from './drawing-store.ts';
import { ProjectStore } from './project-store.ts';
import { documentPathInFolder, serializeDrawing } from './project-files.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let projects: ProjectStore;
let drawings: DrawingStore;
let events: SessionEvent[];
let projectId: string;

function element(id: string, x = 0): DrawingElement {
    return { kind: 'rect', id, x, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 12 };
}

function drawn(...elements: DrawingElement[]): DrawingContent {
    return { elements };
}

/* A project with one canvas and the drawing views the test asks for. */
function content(...drawingIds: string[]): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
            ...drawingIds.map((id) => ({ kind: 'drawing' as const, id, name: id }))
        ]
    };
}

/* Nothing here is shared, so every drawing sits on the private side of the folder. */
function drawingsDir(): string {
    return join(folder, '.ruimte', 'private', 'drawings');
}

function sharedDrawingsDir(): string {
    return join(folder, '.ruimte', 'drawings');
}

function drawingFile(viewId: string): string {
    return join(drawingsDir(), `${viewId}.json`);
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-drawings-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    fake = new FakeWatch();
    projects = new ProjectStore(home, fake);
    drawings = new DrawingStore(projects, fake);
    projects.attachDrawings(drawings);
    events = [];
    drawings.subscribe('c1', (event) => events.push(event));
    const opened = await projects.openProject({ folder });
    projectId = opened.summary.projectId;
    await projects.save(projectId, 0, content('view-a'));
});

afterEach(async () => {
    drawings.closeAll();
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('DrawingStore', () => {
    test('a drawing follows its view into git and back out again', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('e1')), 'c1');
        expect(await exists(drawingFile('view-a'))).toBe(true);

        await projects.save(projectId, 1, content('view-a'), ['view-a']);
        expect(await exists(join(sharedDrawingsDir(), 'view-a.json'))).toBe(true);
        expect(await exists(drawingFile('view-a'))).toBe(false);
        // The bytes went along, so what was drawn is still there after the move.
        expect((await drawings.open(projectId, 'view-a')).elements).toHaveLength(1);

        await projects.save(projectId, 2, content('view-a'), []);
        expect(await exists(drawingFile('view-a'))).toBe(true);
        expect(await exists(join(sharedDrawingsDir(), 'view-a.json'))).toBe(false);
    });

    test('opening a drawing nobody drew gives an empty one and writes nothing', async () => {
        expect(await drawings.open(projectId, 'view-a')).toEqual({ version: 1, rev: 0, elements: [] });
        expect(await exists(drawingFile('view-a'))).toBe(false);
    });

    test('the first save writes rev 1 with one element per line, and the rev rises', async () => {
        await drawings.open(projectId, 'view-a');
        expect(await drawings.save(projectId, 'view-a', 0, drawn(element('el-1'), element('el-2', 200)), 'c1')).toBe(1);
        const text = await readFile(drawingFile('view-a'), 'utf8');
        expect(text.split('\n').filter((line) => line.includes('"kind"'))).toHaveLength(2);
        expect(text.endsWith('\n')).toBe(true);
        expect(JSON.parse(text)).toMatchObject({ version: 1, rev: 1 });
        expect(await drawings.save(projectId, 'view-a', 1, drawn(element('el-1')), 'c1')).toBe(2);
    });

    test('a save based on an older rev is refused', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        await expect(drawings.save(projectId, 'view-a', 0, drawn(), 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a save that gives two elements one id is refused and writes nothing', async () => {
        await drawings.open(projectId, 'view-a');
        await expect(drawings.save(projectId, 'view-a', 0, drawn(element('el-1'), element('el-1', 40)), 'c1')).rejects.toMatchObject({
            code: 'drawing-invalid'
        });
        expect(await exists(drawingFile('view-a'))).toBe(false);
    });

    test('a view that is not a drawing, and a project that is not open, are refused', async () => {
        await expect(drawings.open(projectId, 'main')).rejects.toMatchObject({ code: 'drawing-not-found' });
        await expect(drawings.open('nope', 'view-a')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('an outside write is reported with what is on disk, and our own write is not', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        fake.on(drawingsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toEqual([]);

        // A file of a drawing nobody has open is not read.
        fake.on(drawingsDir()).emit('view-z.json');
        expect(fake.pending).toBe(0);

        await writeFile(drawingFile('view-a'), serializeDrawing({ version: 1, rev: 7, elements: [element('el-9')] }));
        fake.on(drawingsDir()).emit('view-a.json');
        fake.on(drawingsDir()).emit('view-a.json');
        expect(fake.pending).toBe(1);
        await fake.settle();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            event: 'drawing.changed',
            payload: { projectId, viewId: 'view-a', document: { rev: 7, elements: [{ id: 'el-9' }] } }
        });
        // The daemon now expects saves against the rev that came in.
        await expect(drawings.save(projectId, 'view-a', 1, drawn(), 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await drawings.save(projectId, 'view-a', 7, drawn(), 'c1')).toBe(8);
    });

    test('broken JSON is set aside, JSON that is not a drawing stays where it is', async () => {
        await mkdir(drawingsDir(), { recursive: true });
        await writeFile(drawingFile('view-a'), '{ "version": 1, "rev": ');
        expect(await drawings.open(projectId, 'view-a')).toEqual({ version: 1, rev: 0, elements: [] });
        expect((await readdir(drawingsDir())).some((name) => name.startsWith('view-a.json.corrupt-'))).toBe(true);

        await writeFile(drawingFile('view-a'), JSON.stringify({ version: 1, rev: 1, elements: [{ kind: 'star' }] }));
        await expect(drawings.open(projectId, 'view-a')).rejects.toMatchObject({ code: 'drawing-invalid' });
        expect(await exists(drawingFile('view-a'))).toBe(true);
    });

    test('a save right after an outside write is refused, and the write is taken in', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        const theirs = serializeDrawing({ version: 1, rev: 4, elements: [element('el-9')] });
        await writeFile(drawingFile('view-a'), theirs);

        // The watcher has not settled yet.
        await expect(drawings.save(projectId, 'view-a', 1, drawn(), 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await readFile(drawingFile('view-a'), 'utf8')).toBe(theirs);
        expect(events).toEqual([
            { event: 'drawing.changed', payload: { projectId, viewId: 'view-a', document: { version: 1, rev: 4, elements: [element('el-9')] } } }
        ]);

        fake.on(drawingsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toHaveLength(1);
        expect(await drawings.save(projectId, 'view-a', 4, drawn(), 'c1')).toBe(5);
    });

    test('a file caught halfway through an outside write stays where it is until the write is whole', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        await writeFile(drawingFile('view-a'), '{ "version": 1, "rev": 3, "elem');
        fake.on(drawingsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toEqual([]);
        expect(await readdir(drawingsDir())).toEqual(['view-a.json']);

        await writeFile(drawingFile('view-a'), serializeDrawing({ version: 1, rev: 3, elements: [element('el-3')] }));
        fake.on(drawingsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ payload: { document: { rev: 3, elements: [{ id: 'el-3' }] } } });
    });

    test('a save that drops the view removes its file, an outside edit that drops it does not', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        await projects.save(projectId, 1, content('view-a', 'view-b'));
        await drawings.open(projectId, 'view-b');
        await drawings.save(projectId, 'view-b', 0, drawn(element('el-2')), 'c1');

        await projects.save(projectId, 2, content('view-b'));
        expect(await exists(drawingFile('view-a'))).toBe(false);
        expect(await exists(drawingFile('view-b'))).toBe(true);

        // A pull that drops a shared view may run ahead of the drawing's own file, which is someone's work.
        await projects.save(projectId, 3, content('view-b', 'view-c'), ['view-b', 'view-c']);
        const sharedFile = documentPathInFolder(folder);
        const pulled = JSON.parse(await readFile(sharedFile, 'utf8')) as { views: { id: string }[] };
        await writeFile(sharedFile, JSON.stringify({ ...pulled, views: pulled.views.filter((view) => view.id !== 'view-b') }, null, 2));
        fake.on(dirname(sharedFile)).emit('project.json');
        await fake.settle();
        expect(projects.isDrawingView(projectId, 'view-b')).toBe(false);
        expect(await exists(join(sharedDrawingsDir(), 'view-b.json'))).toBe(true);

        // Nor does the next save of a client that took the pull in.
        await projects.save(projectId, 5, content('view-c'));
        expect(await exists(join(sharedDrawingsDir(), 'view-b.json'))).toBe(true);
    });

    test('copy writes the same elements at rev 0, and copying nothing writes nothing', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')), 'c1');
        await projects.save(projectId, 1, content('view-a', 'view-b', 'view-c'));

        await drawings.copy(projectId, 'view-a', 'view-b');
        const copied = JSON.parse(await readFile(drawingFile('view-b'), 'utf8')) as { rev: number; elements: DrawingElement[] };
        expect(copied.rev).toBe(0);
        expect(copied.elements).toEqual([element('el-1')]);
        expect(await drawings.open(projectId, 'view-b')).toMatchObject({ rev: 0 });

        await drawings.copy(projectId, 'view-c', 'view-c');
        expect(await exists(drawingFile('view-c'))).toBe(false);
    });
});
