import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrawingContent, DrawingElement, ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { DrawingStore } from './drawing-store.ts';
import { ProjectStore } from './project-store.ts';
import { serializeDrawing } from './project-files.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let projects: ProjectStore;
let drawings: DrawingStore;
let events: SessionEvent[];
let projectId: string;

const element = (id: string, x = 0): DrawingElement => ({ kind: 'rect', id, x, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 12 });

const drawn = (...elements: DrawingElement[]): DrawingContent => ({ elements });

/* A project with one canvas and the drawing views the test asks for. */
const content = (...drawingIds: string[]): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        ...drawingIds.map((id) => ({ kind: 'drawing' as const, id, name: id }))
    ]
});

/* Nothing here is shared, so every drawing sits on the private side of the folder. */
const drawingsDir = (): string => join(folder, '.ruimte', 'private', 'drawings');

const sharedDrawingsDir = (): string => join(folder, '.ruimte', 'drawings');

const drawingFile = (viewId: string): string => join(drawingsDir(), `${viewId}.json`);

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};

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
        await drawings.save(projectId, 'view-a', 0, drawn(element('e1')));
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
        expect(await drawings.save(projectId, 'view-a', 0, drawn(element('el-1'), element('el-2', 200)))).toBe(1);
        const text = await readFile(drawingFile('view-a'), 'utf8');
        expect(text.split('\n').filter((line) => line.includes('"kind"'))).toHaveLength(2);
        expect(text.endsWith('\n')).toBe(true);
        expect(JSON.parse(text)).toMatchObject({ version: 1, rev: 1 });
        expect(await drawings.save(projectId, 'view-a', 1, drawn(element('el-1')))).toBe(2);
    });

    test('a save based on an older rev is refused', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')));
        await expect(drawings.save(projectId, 'view-a', 0, drawn())).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a view that is not a drawing, and a project that is not open, are refused', async () => {
        await expect(drawings.open(projectId, 'main')).rejects.toMatchObject({ code: 'drawing-not-found' });
        await expect(drawings.open('nope', 'view-a')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('an outside write is reported with what is on disk, and our own write is not', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')));
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
        await expect(drawings.save(projectId, 'view-a', 1, drawn())).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await drawings.save(projectId, 'view-a', 7, drawn())).toBe(8);
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

    test('a save that drops the view removes its file, an outside edit that drops it does not', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')));
        await projects.save(projectId, 1, content('view-a', 'view-b'));
        await drawings.open(projectId, 'view-b');
        await drawings.save(projectId, 'view-b', 0, drawn(element('el-2')));

        await projects.save(projectId, 2, content('view-b'));
        expect(await exists(drawingFile('view-a'))).toBe(false);
        expect(await exists(drawingFile('view-b'))).toBe(true);
    });

    test('copy writes the same elements at rev 0, and copying nothing writes nothing', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')));
        await projects.save(projectId, 1, content('view-a', 'view-b', 'view-c'));

        await drawings.copy(projectId, 'view-a', 'view-b');
        const copied = JSON.parse(await readFile(drawingFile('view-b'), 'utf8')) as { rev: number; elements: DrawingElement[] };
        expect(copied.rev).toBe(0);
        expect(copied.elements).toEqual([element('el-1')]);
        expect(await drawings.open(projectId, 'view-b')).toMatchObject({ rev: 0 });

        await drawings.copy(projectId, 'view-c', 'view-c');
        expect(await exists(drawingFile('view-c'))).toBe(false);
    });

    test('deleting the project with its files takes the drawings directory with it', async () => {
        await drawings.open(projectId, 'view-a');
        await drawings.save(projectId, 'view-a', 0, drawn(element('el-1')));
        await projects.delete(projectId, true);
        expect(await exists(join(folder, '.ruimte'))).toBe(false);
    });
});
