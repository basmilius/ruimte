import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenderSceneResultSchema, type ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { DiagramStore } from '../projects/diagram-store.ts';
import { DrawingStore } from '../projects/drawing-store.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { registerDiagramHandlers } from './diagram.ts';
import { registerDrawingHandlers } from './drawing.ts';

let root: string;
let projects: ProjectStore;
let drawings: DrawingStore;
let diagrams: DiagramStore;
let dispatcher: Dispatcher;
let projectId: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-render-handlers-'));
    const folder = join(root, 'repo');
    await mkdir(folder);
    const watch = new FakeWatch();
    projects = new ProjectStore(join(root, 'home'), watch);
    drawings = new DrawingStore(projects, watch);
    diagrams = new DiagramStore(projects, watch);
    projects.attachDrawings(drawings);
    projects.attachDiagrams(diagrams);
    const opened = await projects.openProject({ folder });
    projectId = opened.summary.projectId;
    await projects.save(projectId, 0, {
        name: 'Project',
        color: '#123456',
        views: [
            { kind: 'drawing', id: 'drawing', name: 'Sketch' },
            { kind: 'diagram', id: 'diagram', name: 'Flow' }
        ]
    });
    dispatcher = new Dispatcher();
    registerDrawingHandlers(dispatcher, drawings);
    registerDiagramHandlers(dispatcher, diagrams);
});

afterEach(async () => {
    drawings.closeAll();
    diagrams.closeAll();
    projects.closeAll();
    await rm(root, { force: true, recursive: true });
});

const request = async (type: string, payload: unknown): Promise<ServerFrame> => {
    const frames: ServerFrame[] = [];
    await dispatcher.handle(
        { id: 'mobile', access: { reachability: 'public', sessionId: 'paired' }, send: (frame) => frames.push(frame) },
        JSON.stringify({ id: 'render', type, payload })
    );
    return frames[0]!;
};

test('render requests read the current persisted revision through the registered stores', async () => {
    await drawings.open(projectId, 'drawing');
    await drawings.save(projectId, 'drawing', 0, {
        elements: [{ id: 'text', kind: 'text', x: 0, y: 0, w: 120, h: 30, stroke: 'ink', strokeWidth: 1, seed: 1, text: 'Sketch', size: 24 }]
    });
    await diagrams.open(projectId, 'diagram');
    await diagrams.save(projectId, 'diagram', 0, { meta: { title: '', direction: 'down' }, nodes: [{ id: 'node', label: 'Flow' }], edges: [], groups: [] });
    for (const [type, viewId, text] of [
        ['drawing.paths', 'drawing', 'Sketch'],
        ['diagram.layout', 'diagram', 'Flow']
    ]) {
        const reply = await request(type!, { projectId, viewId });
        expect(reply).toMatchObject({ ok: true });
        if (!('ok' in reply) || !reply.ok) {
            throw new Error('Expected render reply');
        }
        const scene = RenderSceneResultSchema.parse(reply.result);
        expect(scene.rev).toBe(1);
        expect(scene.elements.flatMap((element) => element.text.map((line) => line.text))).toEqual([text!]);
    }
});

test('render requests enforce project/view scope and reject incomplete targets', async () => {
    expect(await request('drawing.paths', { projectId, viewId: 'diagram' })).toMatchObject({ ok: false });
    expect(await request('diagram.layout', { projectId, viewId: 'drawing' })).toMatchObject({ ok: false });
    expect(await request('diagram.layout', { projectId, viewId: '../outside' })).toMatchObject({ ok: false });
    expect(await request('drawing.paths', { projectId: 'missing', viewId: 'drawing' })).toMatchObject({ ok: false });
    expect(await request('drawing.paths', { viewId: 'drawing' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
});
