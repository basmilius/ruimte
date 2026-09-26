import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_DIAGRAM, type DiagramContent, type DiagramNode, type ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import type { SessionEvent } from '../sessions/manager.ts';
import { DiagramStore } from './diagram-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { ProjectStore } from './project-store.ts';
import { serializeDiagram } from './project-files.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let projects: ProjectStore;
let diagrams: DiagramStore;
let events: SessionEvent[];
let projectId: string;

const node = (id: string, label = id): DiagramNode => ({ id, label });

const graph = (nodes: DiagramNode[], edges: [string, string][] = []): DiagramContent => ({
    meta: { title: 'Wire', direction: 'right' },
    nodes,
    groups: [],
    edges: edges.map(([from, to]) => ({ from, to }))
});

/* A project with one canvas, one drawing and the diagram views the test asks for. */
const content = (...diagramIds: string[]): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'drawing', id: 'sketch', name: 'Sketch' },
        ...diagramIds.map((id) => ({ kind: 'diagram' as const, id, name: id }))
    ]
});

/* Nothing here is shared, so every diagram sits on the private side of the folder; sharing its view moves it, which DrawingStore covers. */
const diagramsDir = (): string => join(folder, '.ruimte', 'private', 'diagrams');

const diagramFile = (viewId: string): string => join(diagramsDir(), `${viewId}.json`);

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-diagrams-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    fake = new FakeWatch();
    projects = new ProjectStore(home, fake);
    projects.attachDrawings(new DrawingStore(projects, fake));
    diagrams = new DiagramStore(projects, fake);
    projects.attachDiagrams(diagrams);
    events = [];
    diagrams.subscribe('c1', (event) => events.push(event));
    const opened = await projects.openProject({ folder });
    projectId = opened.summary.projectId;
    await projects.save(projectId, 0, content('view-a'));
});

afterEach(async () => {
    diagrams.closeAll();
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('DiagramStore', () => {
    test('opening a diagram nobody wrote gives an empty one and writes nothing', async () => {
        expect(await diagrams.open(projectId, 'view-a')).toEqual({
            version: 1,
            rev: 0,
            meta: { title: '', direction: 'right' },
            nodes: [],
            groups: [],
            edges: []
        });
        expect(await exists(diagramFile('view-a'))).toBe(false);
    });

    test('the first save writes rev 1 with one node and one edge per line, and the rev rises', async () => {
        await diagrams.open(projectId, 'view-a');
        expect(await diagrams.save(projectId, 'view-a', 0, graph([node('a'), node('b')], [['a', 'b']]))).toBe(1);
        const text = await readFile(diagramFile('view-a'), 'utf8');
        expect(text.split('\n').filter((line) => line.includes('"label"'))).toHaveLength(2);
        expect(text.split('\n').filter((line) => line.includes('"from"'))).toHaveLength(1);
        expect(text.endsWith('\n')).toBe(true);
        expect(JSON.parse(text)).toMatchObject({ version: 1, rev: 1, meta: { title: 'Wire' } });
        expect(await diagrams.save(projectId, 'view-a', 1, graph([node('a')]))).toBe(2);
    });

    test('a save based on an older rev is refused', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a')]));
        await expect(diagrams.save(projectId, 'view-a', 0, graph([]))).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a save with an edge to an unknown id is refused by that id and writes nothing', async () => {
        await diagrams.open(projectId, 'view-a');
        const refused = diagrams.save(projectId, 'view-a', 0, graph([node('a')], [['a', 'ghost']]));
        await expect(refused).rejects.toMatchObject({ code: 'diagram-invalid' });
        await expect(refused).rejects.toThrow('"ghost"');
        expect(await exists(diagramFile('view-a'))).toBe(false);
    });

    test('a view that is not a diagram, a drawing among them, and a project that is not open, are refused', async () => {
        await expect(diagrams.open(projectId, 'main')).rejects.toMatchObject({ code: 'diagram-not-found' });
        await expect(diagrams.open(projectId, 'sketch')).rejects.toMatchObject({ code: 'diagram-not-found' });
        await expect(diagrams.open('nope', 'view-a')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('an outside write is reported with what is on disk, and our own write is not', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a')]));
        fake.on(diagramsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toEqual([]);

        await writeFile(diagramFile('view-a'), serializeDiagram({ version: 1, rev: 7, ...graph([node('z', 'Zed')]) }));
        // A platform that reports no name could have touched any open diagram.
        fake.on(diagramsDir()).emit(null);
        await fake.settle();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            event: 'diagram.changed',
            payload: { projectId, viewId: 'view-a', document: { rev: 7, nodes: [{ id: 'z', label: 'Zed' }] } }
        });
        // The daemon now expects saves against the rev that came in.
        await expect(diagrams.save(projectId, 'view-a', 1, graph([]))).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await diagrams.save(projectId, 'view-a', 7, graph([]))).toBe(8);
    });

    test('broken JSON is set aside; JSON that is not a diagram, or breaks a rule of one, stays where it is', async () => {
        await mkdir(diagramsDir(), { recursive: true });
        await writeFile(diagramFile('view-a'), '{ "version": 1, "rev": ');
        expect(await diagrams.open(projectId, 'view-a')).toMatchObject({ rev: 0, nodes: [] });
        expect((await readdir(diagramsDir())).some((name) => name.startsWith('view-a.json.corrupt-'))).toBe(true);

        await writeFile(diagramFile('view-a'), JSON.stringify({ version: 1, rev: 1, elements: [] }));
        await expect(diagrams.open(projectId, 'view-a')).rejects.toMatchObject({ code: 'diagram-invalid' });
        expect(await exists(diagramFile('view-a'))).toBe(true);

        await writeFile(diagramFile('view-a'), serializeDiagram({ version: 1, rev: 1, ...graph([node('a')], [['a', 'nowhere']]) }));
        await expect(diagrams.open(projectId, 'view-a')).rejects.toThrow('"nowhere"');
        expect(await exists(diagramFile('view-a'))).toBe(true);
    });

    test('a save that drops the view removes its file, and leaves the other diagrams alone', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a')]));
        await projects.save(projectId, 1, content('view-a', 'view-b'));
        await diagrams.open(projectId, 'view-b');
        await diagrams.save(projectId, 'view-b', 0, graph([node('b')]));

        await projects.save(projectId, 2, content('view-b'));
        expect(await exists(diagramFile('view-a'))).toBe(false);
        expect(await exists(diagramFile('view-b'))).toBe(true);
    });

    test('copy writes the same graph at rev 0, and copying nothing writes nothing', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a'), node('b')], [['a', 'b']]));
        await projects.save(projectId, 1, content('view-a', 'view-b', 'view-c'));

        await diagrams.copy(projectId, 'view-a', 'view-b');
        const copied = JSON.parse(await readFile(diagramFile('view-b'), 'utf8')) as { rev: number; nodes: DiagramNode[] };
        expect(copied.rev).toBe(0);
        expect(copied.nodes).toEqual([node('a'), node('b')]);
        expect(await diagrams.open(projectId, 'view-b')).toMatchObject({ rev: 0 });

        await diagrams.copy(projectId, 'view-c', 'view-c');
        expect(await exists(diagramFile('view-c'))).toBe(false);
    });

    test('deleting the project with its files takes the diagrams directory with it', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a')]));
        await projects.delete(projectId, true);
        expect(await exists(join(folder, '.ruimte'))).toBe(false);
    });
});

describe('DiagramStore.write', () => {
    test('writes a diagram of a project nobody has open, and keeps nothing open after', async () => {
        projects.release(projectId);
        expect(await diagrams.write(projectId, 'view-a', graph([node('a'), node('b')], [['a', 'b']]))).toBe(1);
        expect(await diagrams.write(projectId, 'view-a', graph([node('a')]))).toBe(2);
        expect(JSON.parse(await readFile(diagramFile('view-a'), 'utf8'))).toMatchObject({ rev: 2, nodes: [{ id: 'a' }] });
        expect(events.map((event) => event.event)).toEqual(['diagram.changed', 'diagram.changed']);

        // Opening the project again finds the file where the write left it.
        await projects.openProject({ projectId });
        expect(await diagrams.open(projectId, 'view-a')).toMatchObject({ rev: 2 });
    });

    test('a write to a diagram a client has open moves its rev along and the watcher stays quiet', async () => {
        await diagrams.open(projectId, 'view-a');
        await diagrams.save(projectId, 'view-a', 0, graph([node('a')]));
        expect(await diagrams.write(projectId, 'view-a', graph([node('b')]))).toBe(2);
        fake.on(diagramsDir()).emit('view-a.json');
        await fake.settle();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ event: 'diagram.changed', payload: { viewId: 'view-a', document: { rev: 2 } } });
        await expect(diagrams.save(projectId, 'view-a', 1, graph([]))).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await diagrams.save(projectId, 'view-a', 2, graph([]))).toBe(3);
    });

    test('an unknown id, a view that is not a diagram, a project nobody knows and a file that is not a diagram are refused', async () => {
        projects.release(projectId);
        await expect(diagrams.write(projectId, 'view-a', graph([node('a')], [['ghost', 'a']]))).rejects.toThrow('"ghost"');
        await expect(diagrams.write(projectId, 'sketch', graph([]))).rejects.toMatchObject({ code: 'diagram-not-found' });
        await expect(diagrams.write('nope', 'view-a', graph([]))).rejects.toMatchObject({ code: 'project-not-found' });

        await mkdir(diagramsDir(), { recursive: true });
        await writeFile(diagramFile('view-a'), JSON.stringify({ mine: true }));
        await expect(diagrams.write(projectId, 'view-a', graph([]))).rejects.toMatchObject({ code: 'diagram-invalid' });
        expect(JSON.parse(await readFile(diagramFile('view-a'), 'utf8'))).toEqual({ mine: true });
        expect(events).toEqual([]);
    });

    test('a view an agent adds to a released project is one it can fill right away', async () => {
        projects.release(projectId);
        await projects.mutate(projectId, (current) => ({
            content: { ...current, views: [...current.views, { kind: 'diagram', id: 'view-new', name: 'Fresh', createdBy: 'term-1' }] },
            result: null
        }));
        expect(await diagrams.write(projectId, 'view-new', graph([node('a')]))).toBe(1);
    });
});

describe('DiagramStore.read', () => {
    test('reads a diagram of a released project, empty before anyone wrote it, and null for what is no diagram', async () => {
        projects.release(projectId);
        expect(await diagrams.read(projectId, 'view-a')).toEqual(EMPTY_DIAGRAM);
        await diagrams.write(projectId, 'view-a', graph([node('a')]));
        expect(await diagrams.read(projectId, 'view-a')).toMatchObject({ rev: 1, nodes: [{ id: 'a' }] });
        expect(await diagrams.read(projectId, 'sketch')).toBeNull();
        expect(await diagrams.read('nope', 'view-a')).toBeNull();
    });

    test('a broken file reads as null and stays where it is', async () => {
        await mkdir(diagramsDir(), { recursive: true });
        await writeFile(diagramFile('view-a'), '{ not json');
        expect(await diagrams.read(projectId, 'view-a')).toBeNull();
        expect(await readFile(diagramFile('view-a'), 'utf8')).toBe('{ not json');
    });
});
