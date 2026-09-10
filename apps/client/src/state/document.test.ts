import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { useCanvas } from './canvas';
import { useDocument } from './document';

const view = (id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes,
    texts: [],
    edges: [],
    layouts: []
});

const node = (id: string, x = 0, y = 0): ProjectCanvasView['nodes'][number] => ({ id, kind: 'terminal', title: id, x, y, w: 100, h: 80 });

const document = (views: ProjectCanvasView[]): ProjectDocument => ({ version: 2, rev: 1, name: 'p', color: '#000', views });

const canvasAt = (at: number): ProjectCanvasView => useDocument.getState().views[at] as ProjectCanvasView;

beforeEach(() => {
    useCanvas.getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(document([view('a', [node('n1', 40, 40)]), view('b', [node('n2', 900, 900)])]), {
        activeViewId: 'a',
        views: { a: { camera: { x: 1, y: 2, zoom: 1 }, focusedNodeId: null }, b: { camera: { x: 7, y: 8, zoom: 2 }, focusedNodeId: null } }
    });
});

describe('loading a project', () => {
    test('the first view is on the canvas with its own camera, and the rest waits in the document', () => {
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(useCanvas.getState().order).toEqual(['n1']);
        expect(useCanvas.getState().camera).toEqual({ x: 1, y: 2, zoom: 1 });
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'b']);
    });

    test('a view of its own comes back as the one that was open', () => {
        const views = [view('a'), { kind: 'browser' as const, id: 'page', name: 'Page', url: 'https://bas.dev' }];
        useDocument.getState().load({ version: 2, rev: 1, name: 'p', color: '#000', views }, { activeViewId: 'a', views: {} });
        useDocument.getState().setActiveView('page');
        const local = useDocument.getState().exportLocal();
        expect(local.activeViewId).toBe('page');
        useDocument.getState().load({ version: 2, rev: 1, name: 'p', color: '#000', views }, local);
        expect(useDocument.getState().activeViewId).toBe('page');
        expect(useDocument.getState().bodyFocused).toBe(true);
    });

    test('the view the machine had open wins over the first one, and a view that is gone falls back', () => {
        useDocument.getState().load(document([view('a'), view('b')]), { activeViewId: 'b', views: {} });
        expect(useDocument.getState().activeViewId).toBe('b');
        useDocument.getState().load(document([view('a'), view('b')]), { activeViewId: 'gone', views: {} });
        expect(useDocument.getState().activeViewId).toBe('a');
    });
});

describe('switching views', () => {
    test('the canvas is written back before the next one loads, and nothing moves', () => {
        useCanvas.getState().select(['n1']);
        useCanvas.getState().moveSelected(16, 16);
        useDocument.getState().setActiveView('b');

        expect(useCanvas.getState().order).toEqual(['n2']);
        expect(canvasAt(0).nodes[0]).toMatchObject({ id: 'n1', x: 56, y: 56 });

        useDocument.getState().setActiveView('a');
        expect(useCanvas.getState().nodes.n1).toMatchObject({ x: 56, y: 56 });
    });

    test('the camera of a view comes back, and the undo history does not travel with it', () => {
        useCanvas.getState().panBy(10, 10);
        useDocument.getState().setActiveView('b');
        expect(useCanvas.getState().camera).toEqual({ x: 7, y: 8, zoom: 2 });
        expect(useCanvas.getState().past).toEqual([]);

        useDocument.getState().setActiveView('a');
        expect(useCanvas.getState().camera).toEqual({ x: 11, y: 12, zoom: 1 });
    });

    test('a switch is no edit of the document, adding a view is', () => {
        const before = useDocument.getState().edits;
        useDocument.getState().setActiveView('b');
        expect(useDocument.getState().edits).toBe(before);
        useDocument.getState().addCanvasView('Third');
        expect(useDocument.getState().edits).toBe(before + 1);
        expect(useDocument.getState().activeViewId).toBe(useDocument.getState().views[2]!.id);
    });
});

describe('changing the list of views', () => {
    test('deleting the view that is open opens its neighbor', () => {
        useDocument.getState().deleteView('a');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['b']);
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(useCanvas.getState().order).toEqual(['n2']);
    });

    test('deleting the last view leaves an empty canvas behind, because a project always has one', () => {
        useDocument.getState().deleteView('a');
        useDocument.getState().deleteView('b');
        expect(useDocument.getState().views).toHaveLength(1);
        expect(canvasAt(0)).toMatchObject({ id: 'main', name: 'Canvas', nodes: [] });
    });

    test('a duplicate lands next to its original with new ids and no session to resume', () => {
        useCanvas.getState().updateNode('n1', { resume: 'session-1' });
        const copyId = useDocument.getState().duplicateView('a');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', copyId!, 'b']);
        const copy = canvasAt(1);
        expect(copy.name).toBe('a copy');
        expect(copy.nodes[0]!.id).not.toBe('n1');
        expect(copy.nodes[0]!.resume).toBeUndefined();
    });

    test('reordering writes the order into the document', () => {
        useDocument.getState().moveView('b', 0);
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['b', 'a']);
    });

    test('a node moved to another view keeps its id and leaves its lines behind', () => {
        useCanvas.getState().addText({ x: 0, y: 0 });
        const textId = useCanvas.getState().selection[0]!;
        useCanvas.getState().addEdge('n1', textId);
        useDocument.getState().moveNodeToView('n1', 'b');

        expect(useCanvas.getState().order).toEqual([]);
        expect(useCanvas.getState().edges).toEqual([]);
        expect(canvasAt(1).nodes.map((each) => each.id)).toEqual(['n2', 'n1']);
    });
});

describe('a node and a view of its own', () => {
    test('a promoted node keeps its id and loses the lines it was part of', () => {
        useCanvas.getState().addText({ x: 0, y: 0 });
        const textId = useCanvas.getState().selection[0]!;
        useCanvas.getState().addEdge('n1', textId);

        const viewId = useDocument.getState().openAsView('n1');
        expect(viewId).toBe('n1');
        expect(useDocument.getState().activeViewId).toBe('n1');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'n1', 'b']);
        expect(useDocument.getState().views[1]).toMatchObject({ kind: 'terminal', name: 'n1' });
        // The canvas it left keeps the text, without the line that ran to the node.
        const left = useDocument.getState().views[0] as ProjectCanvasView;
        expect(left.nodes).toEqual([]);
        expect(left.edges).toEqual([]);
        expect(left.texts).toHaveLength(1);
    });

    test('the keyboard starts in the body of a view of its own and the canvas keeps its own state', () => {
        useDocument.getState().openAsView('n1');
        expect(useDocument.getState().bodyFocused).toBe(true);
        useDocument.getState().setActiveView('b');
        expect(useDocument.getState().bodyFocused).toBe(false);
    });

    test('a view put back on a canvas becomes a node there, selected, under the same id', () => {
        useDocument.getState().openAsView('n1');
        expect(useDocument.getState().putOnCanvas('n1', 'a')).toBe(true);
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'b']);
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(useCanvas.getState().order).toEqual(['n1']);
        expect(useCanvas.getState().selection).toEqual(['n1']);
        expect(useCanvas.getState().nodes.n1).toMatchObject({ id: 'n1', kind: 'terminal', title: 'n1' });
    });

    test('what a node carries travels both ways', () => {
        useCanvas.getState().updateNode('n1', { cwd: '/repo/apps', command: 'bun dev' });
        useDocument.getState().openAsView('n1');
        expect(useDocument.getState().views[1]).toMatchObject({ node: { cwd: '/repo/apps', command: 'bun dev' } });
        useDocument.getState().putOnCanvas('n1', 'a');
        expect(useCanvas.getState().nodes.n1).toMatchObject({ cwd: '/repo/apps', command: 'bun dev' });
    });

    test('only a session can leave the canvas, and a view of its own is not duplicated', () => {
        useCanvas.getState().addNode('group', { x: 0, y: 0 });
        const groupId = useCanvas.getState().selection[0]!;
        expect(useDocument.getState().openAsView(groupId)).toBeNull();
        useDocument.getState().openAsView('n1');
        expect(useDocument.getState().duplicateView('n1')).toBeNull();
    });

    test('a new standalone view opens on the spot and carries what it was made with', () => {
        const id = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Claude', node: { provider: 'claude', providerFixed: true } });
        expect(useDocument.getState().activeViewId).toBe(id);
        expect(useDocument.getState().views.at(-1)).toMatchObject({ kind: 'chat', name: 'Claude', node: { provider: 'claude' } });
        useDocument.getState().updateStandalone(id, { cwd: '/repo' });
        expect(useDocument.getState().views.at(-1)).toMatchObject({ node: { cwd: '/repo', provider: 'claude' } });
    });
});

describe('what a save would write', () => {
    test('the canvas on screen is folded back into the view it belongs to', () => {
        useCanvas.getState().addNode('chat', { x: 0, y: 0 });
        const views = useDocument.getState().exportViews() as ProjectCanvasView[];
        expect(views[0]!.nodes).toHaveLength(2);
        expect(views[1]!.nodes.map((each) => each.id)).toEqual(['n2']);
    });

    test('the local file carries every view that was visited, with the live camera for the open one', () => {
        useCanvas.getState().panBy(4, 4);
        const local = useDocument.getState().exportLocal();
        expect(local.activeViewId).toBe('a');
        expect(local.views.a).toEqual({ camera: { x: 5, y: 6, zoom: 1 }, focusedNodeId: null });
        expect(local.views.b).toEqual({ camera: { x: 7, y: 8, zoom: 2 }, focusedNodeId: null });
    });
});
