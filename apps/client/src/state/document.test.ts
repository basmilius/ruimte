import { beforeEach, describe, expect, test } from 'bun:test';
import { ProjectSavePayloadSchema, storedContentOf, type ProjectCanvasView, type ProjectDocument, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { viewIdsIn } from '@/shell/split';
import { focusedCanvas } from './canvas';
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

/* An editor is made when its view goes into a cell and gets its size a frame later, from the cell. */
const measure = (): void => focusedCanvas().getState().setViewport({ w: 800, h: 600 });

beforeEach(() => {
    useDocument.getState().load(document([view('a', [node('n1', 40, 40)]), view('b', [node('n2', 900, 900)])]), {
        activeViewId: 'a',
        views: {
            a: { camera: { center: { x: 399, y: 298 }, zoom: 1 }, focusedNodeId: null },
            b: { camera: { center: { x: 196.5, y: 146 }, zoom: 2 }, focusedNodeId: null }
        }
    });
    measure();
});

describe('loading a project', () => {
    test('the first view is on the canvas with its own camera, and the rest waits in the document', () => {
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(focusedCanvas().getState().order).toEqual(['n1']);
        expect(focusedCanvas().getState().camera).toEqual({ x: 1, y: 2, zoom: 1 });
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
        focusedCanvas().getState().select(['n1']);
        focusedCanvas().getState().moveSelected(16, 16);
        useDocument.getState().setActiveView('b');

        expect(focusedCanvas().getState().order).toEqual(['n2']);
        expect(canvasAt(0).nodes[0]).toMatchObject({ id: 'n1', x: 56, y: 56 });

        useDocument.getState().setActiveView('a');
        expect(focusedCanvas().getState().nodes.n1).toMatchObject({ x: 56, y: 56 });
    });

    test('the camera of a view comes back, and the undo history does not travel with it', () => {
        focusedCanvas().getState().panBy(10, 10);
        useDocument.getState().setActiveView('b');
        measure();
        expect(focusedCanvas().getState().camera).toEqual({ x: 7, y: 8, zoom: 2 });
        expect(focusedCanvas().getState().past).toEqual([]);

        useDocument.getState().setActiveView('a');
        measure();
        expect(focusedCanvas().getState().camera).toEqual({ x: 11, y: 12, zoom: 1 });
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

describe('a view an agent asked for', () => {
    test('takes the focused cell and says what stood there, so the toast can put it back', () => {
        const shown = useDocument.getState().showView('b')!;
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(shown.replaced).toBe('a');
        useDocument.getState().undoShowView(shown);
        expect(useDocument.getState().activeViewId).toBe('a');
    });

    test('the view already in front is nothing to show, and a view this document has not got is ignored', () => {
        expect(useDocument.getState().showView('a')).toBeNull();
        expect(useDocument.getState().showView('gone')).toBeNull();
        expect(useDocument.getState().activeViewId).toBe('a');
    });

    test('showing is no edit: what a person looks at never reaches the shared file', () => {
        const before = useDocument.getState().edits;
        const shown = useDocument.getState().showView('b')!;
        useDocument.getState().undoShowView(shown);
        expect(useDocument.getState().edits).toBe(before);
    });

    test('a view standing in another cell takes the focus instead of appearing twice', () => {
        useDocument.getState().splitFocused('right', 'b');
        expect(useDocument.getState().activeViewId).toBe('b');
        const shown = useDocument.getState().showView('a')!;
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(shown.replaced).toBeNull();
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['a', 'b']);
        useDocument.getState().undoShowView(shown);
        expect(useDocument.getState().activeViewId).toBe('b');
    });
});

describe('the banner an agent leaves over the views', () => {
    /* The two an agent can leave: the request nothing moved for, and the way back out of a view that took the cell. */
    const asks = (viewId: string, message = 'asked'): void => useDocument.getState().showNotice({ message, action: { kind: 'go', viewId } });
    const showed = (viewId: string, message = 'showed'): void => {
        const shown = useDocument.getState().showView(viewId)!;
        useDocument.getState().showNotice({ message, action: { kind: 'back', shown } });
    };

    test('the request goes where it names and is done', () => {
        asks('b');
        useDocument.getState().runNotice();
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(useDocument.getState().viewNotice).toBeNull();
    });

    test('the way back puts the grid back and is done', () => {
        showed('b');
        expect(useDocument.getState().activeViewId).toBe('b');
        useDocument.getState().runNotice();
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(useDocument.getState().viewNotice).toBeNull();
    });

    test('dismissing either one leaves the grid where it is', () => {
        showed('b');
        useDocument.getState().dismissNotice();
        expect(useDocument.getState().viewNotice).toBeNull();
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('switching view by hand drops the way back, since it describes a grid that is gone', () => {
        showed('b');
        useDocument.getState().setActiveView('a');
        expect(useDocument.getState().viewNotice).toBeNull();
    });

    test('a request survives a switch of your own, unless the switch is you arriving there', () => {
        asks('b');
        useDocument.getState().addCanvasView('c');
        expect(useDocument.getState().viewNotice).not.toBeNull();
        useDocument.getState().setActiveView('b');
        expect(useDocument.getState().viewNotice).toBeNull();
    });

    test('a second open replaces the banner, and the way back is then out of the second view', () => {
        const third = useDocument.getState().addCanvasView('c');
        useDocument.getState().setActiveView('a');
        showed('b', 'first');
        showed(third, 'second');
        expect(useDocument.getState().viewNotice?.message).toBe('second');
        useDocument.getState().runNotice();
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('a view that is deleted or a project that is swapped out takes its banner with it', () => {
        asks('b');
        useDocument.getState().deleteView('b');
        expect(useDocument.getState().viewNotice).toBeNull();
        asks('a');
        useDocument.getState().load(document([view('c')]), { activeViewId: 'c', views: {} });
        expect(useDocument.getState().viewNotice).toBeNull();
    });
});

describe('changing the list of views', () => {
    test('deleting the view that is open opens its neighbor', () => {
        useDocument.getState().deleteView('a');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['b']);
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(focusedCanvas().getState().order).toEqual(['n2']);
    });

    test('deleting the last view leaves an empty canvas behind, because a project always has one', () => {
        useDocument.getState().deleteView('a');
        useDocument.getState().deleteView('b');
        expect(useDocument.getState().views).toHaveLength(1);
        expect(canvasAt(0)).toMatchObject({ id: 'main', name: 'Canvas', nodes: [] });
    });

    test('a duplicate lands next to its original with new ids and no session to resume', () => {
        focusedCanvas().getState().updateNode('n1', { resume: 'session-1' });
        const copyId = useDocument.getState().duplicateView('a');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', copyId!, 'b']);
        const copy = canvasAt(1);
        expect(copy.name).toBe('a copy');
        expect(copy.nodes[0]!.id).not.toBe('n1');
        expect(copy.nodes[0]!.resume).toBeUndefined();
    });

    test('a view keeps the icon a person picked until it is handed back', () => {
        useDocument.getState().setViewIcon('a', { kind: 'lucide', value: 'rocket' });
        expect(useDocument.getState().views[0]).toMatchObject({ icon: { kind: 'lucide', value: 'rocket' } });

        useDocument.getState().setViewIcon('a', null);
        expect(canvasAt(0).icon).toBeUndefined();
    });

    test('handing back an icon a view never had claims no edit', () => {
        const before = useDocument.getState().edits;
        useDocument.getState().setViewIcon('a', null);
        expect(useDocument.getState().edits).toBe(before);
        useDocument.getState().setViewIcon('a', { kind: 'emoji', value: '\u{1f680}' });
        expect(useDocument.getState().edits).toBe(before + 1);
    });

    test('reordering writes the order into the document', () => {
        useDocument.getState().moveView('b', 0);
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['b', 'a']);
    });

    test('a node moved to another view keeps its id and leaves its lines behind', () => {
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        const textId = focusedCanvas().getState().selection[0]!;
        focusedCanvas().getState().addEdge('n1', textId);
        useDocument.getState().moveNodeToView('n1', 'b');

        expect(focusedCanvas().getState().order).toEqual([]);
        expect(focusedCanvas().getState().edges).toEqual([]);
        expect(canvasAt(1).nodes.map((each) => each.id)).toEqual(['n2', 'n1']);
    });
});

describe('a node and a view of its own', () => {
    test('a promoted node keeps its id and loses the lines it was part of', () => {
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        const textId = focusedCanvas().getState().selection[0]!;
        focusedCanvas().getState().addEdge('n1', textId);

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
        expect(focusedCanvas().getState().order).toEqual(['n1']);
        expect(focusedCanvas().getState().selection).toEqual(['n1']);
        expect(focusedCanvas().getState().nodes.n1).toMatchObject({ id: 'n1', kind: 'terminal', title: 'n1' });
    });

    test('what a node carries travels both ways', () => {
        focusedCanvas().getState().updateNode('n1', { cwd: '/repo/apps', command: 'bun dev' });
        useDocument.getState().openAsView('n1');
        expect(useDocument.getState().views[1]).toMatchObject({ node: { cwd: '/repo/apps', command: 'bun dev' } });
        useDocument.getState().putOnCanvas('n1', 'a');
        expect(focusedCanvas().getState().nodes.n1).toMatchObject({ cwd: '/repo/apps', command: 'bun dev' });
    });

    test('only a session can leave the canvas, and a view of its own is not duplicated', () => {
        focusedCanvas().getState().addNode('group', { x: 0, y: 0 });
        const groupId = focusedCanvas().getState().selection[0]!;
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
        focusedCanvas().getState().addNode('chat', { x: 0, y: 0 });
        const views = useDocument.getState().exportViews() as ProjectCanvasView[];
        expect(views[0]!.nodes).toHaveLength(2);
        expect(views[1]!.nodes.map((each) => each.id)).toEqual(['n2']);
    });

    test('who made a view survives the trip through the editor, so a save never drops it', () => {
        const views: ProjectCanvasView[] = [{ ...view('a', [node('n1')]), createdBy: 'term-1' }, view('b')];
        useDocument.getState().load(document(views), { activeViewId: 'a', views: {} });
        focusedCanvas().getState().addNode('note', { x: 0, y: 0 });
        expect(useDocument.getState().exportViews()[0]).toMatchObject({ createdBy: 'term-1' });
    });

    test('the local file carries every view that was visited, with the live camera for the open one', () => {
        focusedCanvas().getState().panBy(4, 4);
        const local = useDocument.getState().exportLocal();
        expect(local.activeViewId).toBe('a');
        expect(local.views.a).toEqual({ camera: { center: { x: 395, y: 294 }, zoom: 1 }, focusedNodeId: null });
        expect(local.views.b).toEqual({ camera: { center: { x: 196.5, y: 146 }, zoom: 2 }, focusedNodeId: null });
    });
});

describe('a drawing view', () => {
    test('a new drawing opens on the spot and carries nothing but its name', () => {
        const id = useDocument.getState().addDrawingView('Sketch');
        expect(useDocument.getState().activeViewId).toBe(id);
        expect(useDocument.getState().views.at(-1)).toEqual({ kind: 'drawing', id, name: 'Sketch' });
        // It is not a canvas, so the canvas store lets go of the view it had.
        expect(focusedCanvas().getState().viewId).toBeNull();
        expect(useDocument.getState().bodyFocused).toBe(true);
    });

    test('a duplicate lands next to it under a new id, so the daemon can copy the file into it', () => {
        const id = useDocument.getState().addDrawingView('Sketch');
        const copyId = useDocument.getState().duplicateView(id);
        expect(copyId).not.toBe(id);
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'b', id, copyId!]);
        expect(useDocument.getState().views.at(-1)).toMatchObject({ kind: 'drawing', name: 'Sketch copy' });
    });

    test('it never becomes a node on a canvas: it is a file, not a session', () => {
        const id = useDocument.getState().addDrawingView('Sketch');
        expect(useDocument.getState().putOnCanvas(id, 'a')).toBe(false);
        expect(useDocument.getState().views.map((each) => each.id)).toContain(id);
    });

    test('deleting it takes its local state with it and opens the neighbor', () => {
        const id = useDocument.getState().addDrawingView('Sketch');
        useDocument.getState().deleteView(id);
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'b']);
        expect(useDocument.getState().activeViewId).toBe('b');
    });
});

describe('what a newer Ruimte wrote', () => {
    const hologram: ProjectNode = {
        id: 'holo',
        kind: 'unknown',
        title: 'Hologram',
        x: 300,
        y: 0,
        w: 100,
        h: 80,
        raw: { kind: 'hologram', id: 'holo', title: 'Hologram', x: 300, y: 0, w: 100, h: 80, beam: { lumens: [1, 2] } }
    };
    const timeline: ProjectView = { kind: 'unknown', id: 'timeline', name: 'Flow', raw: { kind: 'timeline', id: 'timeline', name: 'Flow', tracks: [] } };

    beforeEach(() => {
        const views = [timeline, view('a', [node('n1'), hologram])];
        useDocument.getState().load({ version: 2, rev: 1, name: 'p', color: '#000', views } as ProjectDocument, { activeViewId: 'timeline', views: {} });
        measure();
    });

    test('a view of an unknown kind never opens, so the canvas after it does', () => {
        expect(useDocument.getState().activeViewId).toBe('a');
        useDocument.getState().setActiveView('timeline');
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(useDocument.getState().showView('timeline')).toBeNull();
    });

    test('an edit of the canvas keeps both entries, and what is sent is what the file held', () => {
        focusedCanvas().getState().addNode('note', { x: 0, y: 400 });
        const views = useDocument.getState().exportViews();
        expect(views[0]).toEqual(timeline);
        expect((views[1] as ProjectCanvasView).nodes[1]).toEqual(hologram);

        const sent = ProjectSavePayloadSchema.parse(JSON.parse(JSON.stringify({ projectId: 'p', baseRev: 1, content: { name: 'p', color: '#000', views } })));
        const stored = storedContentOf(sent.content).views;
        expect(stored[0]).toEqual(timeline.raw);
        expect((stored[1] as { nodes: unknown[] }).nodes[1]).toEqual(hologram.raw);
    });

    test('a person may move or delete an unknown node, and nothing else about it changes', () => {
        const canvas = focusedCanvas().getState();
        canvas.renameNode('holo', 'Other');
        canvas.setNodeAccent('holo', 'red');
        canvas.duplicateNode('holo');
        expect(focusedCanvas().getState().nodes.holo).toEqual(hologram);
        expect(focusedCanvas().getState().order).toEqual(['n1', 'holo']);

        focusedCanvas().getState().select(['holo']);
        focusedCanvas().getState().deleteSelected();
        expect((useDocument.getState().exportViews()[1] as ProjectCanvasView).nodes.map((each) => each.id)).toEqual(['n1']);
    });

    test('a person may delete an unknown view', () => {
        useDocument.getState().deleteView('timeline');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a']);
    });
});
