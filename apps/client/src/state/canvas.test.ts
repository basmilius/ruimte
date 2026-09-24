import { describe, expect, test } from 'bun:test';
import { groupFrame, ProjectCanvasViewSchema, type ProjectCanvasView } from '@ruimte/contracts';
import { toWorld } from '@/canvas/math';
import type { CanvasPatch } from '@/project/merge';
import { carriedByGroups, createCanvasStore, focusedCanvas, isNodeActive, patchSnapshot, type CanvasNode } from './canvas';

/* Every test here is about one editor, and with no workspace open that is the module's own. */
const canvas = () => focusedCanvas().getState();

const node = (id: string, x: number, y: number, kind: CanvasNode['kind'] = 'terminal'): CanvasNode => ({ id, kind, title: id, x, y, w: 200, h: 100 });

describe('groups', () => {
    test('a group carries the nodes, texts and nested groups inside it, never the selected ones', () => {
        const nodes = {
            g: node('g', 0, 0, 'group'),
            inside: node('inside', 10, 10),
            outside: node('outside', 500, 500),
            picked: node('picked', 20, 20),
            other: node('other', 30, 30, 'group')
        };
        nodes.g.w = 400;
        nodes.g.h = 400;
        const texts = { t1: { id: 't1', x: 50, y: 50, text: 'in', size: 18 }, t2: { id: 't2', x: 900, y: 900, text: 'out', size: 18 } };
        expect([...carriedByGroups(nodes, texts, ['g', 'picked'])].sort()).toEqual(['inside', 'other', 't1']);
        expect(carriedByGroups(nodes, texts, ['inside']).size).toBe(0);
    });

    test('moving a selected group moves what it carries and groupSelection wraps the selection', () => {
        const store = canvas();
        focusedCanvas().setState({ nodes: { a: node('a', 100, 100), b: node('b', 400, 100) }, texts: {}, order: ['a', 'b'], selection: ['a', 'b'], edges: [] });
        const groupId = store.groupSelection();
        expect(groupId).not.toBeNull();
        const group = canvas().nodes[groupId!]!;
        expect(group.kind).toBe('group');
        expect(group.x).toBeLessThan(100);
        expect(group.x + group.w).toBeGreaterThan(600);
        expect(canvas().selection).toEqual([groupId!]);
        // The frame the daemon's `node group` action draws around the same nodes, which is the point of sharing it.
        expect(group).toMatchObject(groupFrame([node('a', 100, 100), node('b', 400, 100)])!);

        canvas().moveSelected(16, 8);
        const after = canvas().nodes;
        expect(after.a).toMatchObject({ x: 116, y: 108 });
        expect(after.b).toMatchObject({ x: 416, y: 108 });
        expect(after[groupId!]).toMatchObject({ x: group.x + 16, y: group.y + 8 });
    });

    test('a box drawn over a collapsed group takes the group, never the nodes folded into it', () => {
        focusedCanvas().setState({
            nodes: { a: node('a', 100, 100), b: node('b', 400, 100), far: node('far', 2000, 2000) },
            texts: { t1: { id: 't1', x: 150, y: 150, text: 'in', size: 18 } },
            order: ['a', 'b', 'far'],
            selection: ['a', 'b', 't1'],
            edges: [],
            hidden: new Set()
        });
        const groupId = canvas().groupSelection()!;
        canvas().toggleGroupCollapse(groupId);
        canvas().clearSelection();

        canvas().selectInRect({ x: 0, y: 0, w: 1000, h: 1000 });
        expect(canvas().selection).toEqual([groupId]);

        // The same box with the modifier down adds to what is already selected.
        canvas().selectInRect({ x: 1900, y: 1900, w: 400, h: 400 }, true);
        expect([...canvas().selection].sort()).toEqual([groupId, 'far'].sort());
    });
});

describe('edges', () => {
    const seed = (): void => {
        focusedCanvas().setState({
            nodes: {
                shell: node('shell', 0, 0),
                page: node('page', 400, 0, 'browser'),
                memo: node('memo', 0, 400, 'note'),
                frame: node('frame', 400, 400, 'group'),
                talk: node('talk', 800, 400, 'chat')
            },
            texts: { t1: { id: 't1', x: 800, y: 0, text: 'hello', size: 18 } },
            order: ['shell', 'page', 'memo', 'frame', 'talk'],
            edges: [],
            selection: [],
            linkDraft: null
        });
    };

    test('nodes connect to each other, and only a line into an agent is labeled context', () => {
        seed();
        const s = canvas();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('memo', 'frame')).not.toBeNull();
        expect(s.addEdge('frame', 'shell')).not.toBeNull();
        expect(canvas().edges.map((edge) => edge.label)).toEqual([undefined, undefined, 'context']);
    });

    test('text cannot start or receive a connector', () => {
        seed();
        expect(canvas().addEdge('frame', 't1')).toBeNull();
        expect(canvas().addEdge('t1', 'shell')).toBeNull();
        canvas().startLink('t1');
        expect(canvas().linkDraft).toBeNull();
        expect(canvas().edges).toEqual([]);
    });

    test('the way back is a line of its own, and nothing connects to itself, to a stranger or twice the same way', () => {
        seed();
        const s = canvas();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('page', 'memo')).toBeNull();
        expect(s.addEdge('memo', 'page')).not.toBeNull();
        expect(s.addEdge('memo', 'page')).toBeNull();
        expect(s.addEdge('page', 'page')).toBeNull();
        expect(s.addEdge('page', 'missing')).toBeNull();
        expect(canvas().edges).toHaveLength(2);
    });

    test('a line between two agents is drawn both ways at once, as one step of the history', () => {
        seed();
        const id = canvas().addEdge('shell', 'talk', { fromSide: 'right', toSide: 'left' });
        const edges = canvas().edges;
        expect(edges).toHaveLength(2);
        expect(edges[0]).toMatchObject({ id: id!, from: 'shell', to: 'talk', label: 'context', fromSide: 'right', toSide: 'left' });
        expect(edges[1]).toMatchObject({ from: 'talk', to: 'shell', label: 'context', fromSide: 'left', toSide: 'right' });
        // One handling, so one undo takes the whole pair away and neither line is left behind.
        canvas().undo();
        expect(canvas().edges).toEqual([]);
    });

    test('a line into anything but an agent stays one line', () => {
        seed();
        expect(canvas().addEdge('talk', 'memo')).not.toBeNull();
        expect(canvas().edges).toHaveLength(1);
        expect(canvas().edges[0]).toMatchObject({ from: 'talk', to: 'memo', label: undefined });
    });

    test('a field a newer Ruimte put on an edge is still on it when the canvas is handed back', () => {
        const edge = { id: 'edge-1', from: 'shell', to: 'page', label: 'context', relation: 'origin' };
        // Through the schema the client checks a reply with, so this is the canvas as it arrives from the daemon.
        const view = ProjectCanvasViewSchema.parse({
            kind: 'canvas',
            id: 'view',
            name: 'Canvas',
            nodes: [node('shell', 0, 0), node('page', 400, 0, 'browser')],
            texts: [],
            edges: [edge],
            layouts: []
        });
        const store = createCanvasStore();
        store.getState().loadView(view, null);
        store.getState().setEdgeLabel('edge-1', 'reads');
        expect(store.getState().exportContent().edges).toEqual([{ ...edge, label: 'reads' }]);
    });

    test('"Connect to..." aims a draft from the node until a target is added', () => {
        seed();
        canvas().startLink('page');
        expect(canvas().linkDraft).toMatchObject({ from: 'page', aiming: true, to: { x: 500, y: 50 } });
        canvas().addEdge('page', 'shell');
        expect(canvas().linkDraft).toBeNull();
    });
});

describe('the camera of an editor that has not been measured', () => {
    const viewWith = (...nodes: CanvasNode[]): ProjectCanvasView => ({
        kind: 'canvas',
        id: 'view',
        name: 'Canvas',
        nodes,
        texts: [],
        edges: [],
        layouts: []
    });

    /* A view that goes into a cell gets an editor a frame before the element holding it has a size,
       so revealing a node on another view lands here. Without the wait the node ends up in the
       corner, which is the whole of the bug, since the middle of a viewport of zero is (0, 0). */
    test('goToNode waits for the size instead of parking the node in the top left', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 1000, 600)), { camera: { center: { x: 600, y: 400 }, zoom: 1 }, focusedNodeId: null });

        store.getState().goToNode('a');
        expect(store.getState().pendingCamera).toEqual({ kind: 'node', id: 'a' });
        expect(store.getState().selection).toEqual(['a']);

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        const { camera } = store.getState();
        expect(toWorld(camera, { x: 600, y: 400 })).toEqual({ x: 1100, y: 650 });
    });

    test('a measured editor centers on the spot and leaves nothing waiting', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 1000, 600)), { camera: { center: { x: 600, y: 400 }, zoom: 1 }, focusedNodeId: null });
        store.getState().setViewport({ w: 1200, h: 800 });

        store.getState().goToNode('a');
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual({ x: 1100, y: 650 });
    });

    test('a view with no camera of its own fits itself once there is room, and an empty one waits for nothing', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0), node('b', 800, 400)), null);
        expect(store.getState().pendingCamera).toEqual({ kind: 'fit' });

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual({ x: 500, y: 250 });

        const empty = createCanvasStore();
        empty.getState().loadView(viewWith(), null);
        expect(empty.getState().pendingCamera).toBeNull();
    });

    test('a stored camera survives the first viewport and keeps its middle in any size of cell', () => {
        const store = createCanvasStore();
        const stored = { center: { x: 420, y: -180 }, zoom: 0.5 };
        store.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(store.getState().pendingCamera).toEqual({ kind: 'view', view: stored });

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual(stored.center);
        expect(store.getState().viewCamera()).toEqual(stored);

        const small = createCanvasStore();
        small.getState().setViewport({ w: 400, h: 300 });
        small.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(small.getState().pendingCamera).toBeNull();
        expect(toWorld(small.getState().camera, { x: 200, y: 150 })).toEqual(stored.center);
    });

    test('without a stored camera the view is fitted exactly once, not again on every resize', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0), node('b', 800, 400)), null);
        store.getState().setViewport({ w: 1200, h: 800 });
        store.getState().panBy(30, 40);
        const moved = store.getState().camera;

        store.getState().setViewport({ w: 1000, h: 700 });
        expect(store.getState().camera).toEqual(moved);
        expect(store.getState().pendingCamera).toBeNull();
    });

    test('an editor that was never measured exports the camera it was given, and nothing while it waits for a fit', () => {
        const stored = { center: { x: 10, y: 20 }, zoom: 2 };
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(store.getState().viewCamera()).toBe(stored);

        const fitting = createCanvasStore();
        fitting.getState().loadView(viewWith(node('a', 0, 0)), null);
        expect(fitting.getState().viewCamera()).toBeNull();
    });

    test('two editors each keep the size of their own cell', () => {
        const left = createCanvasStore();
        const right = createCanvasStore();
        left.getState().setViewport({ w: 600, h: 800 });
        right.getState().setViewport({ w: 900, h: 400 });
        expect(left.getState().viewport).toEqual({ w: 600, h: 800 });
        expect(right.getState().viewport).toEqual({ w: 900, h: 400 });
    });
});

describe('notes', () => {
    test('dictated text can be undone in one step without removing earlier typing', () => {
        const store = createCanvasStore();
        store.setState({ viewId: 'main' });
        const id = store.getState().addNode('note', { x: 0, y: 0 })!;
        store.getState().updateNode(id, { body: 'Typed first. ' });
        store.getState().updateNode(id, { body: 'Typed first. Dictated sentence.' }, true);
        store.getState().undo();
        expect(store.getState().nodes[id]?.body).toBe('Typed first. ');
        store.getState().redo();
        expect(store.getState().nodes[id]?.body).toBe('Typed first. Dictated sentence.');
    });

    test('a note starts empty with the default title and keeps its body and color through updateNode', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = canvas().addNode('note', { x: 0, y: 0 })!;
        expect(canvas().nodes[id]).toMatchObject({ kind: 'note', title: 'Note' });
        canvas().updateNode(id, { body: '# Hello', color: 'blue' });
        expect(canvas().exportContent().nodes[0]).toMatchObject({ id, body: '# Hello', color: 'blue' });
    });
});

describe('the node the keyboard is in', () => {
    const two = (): void => {
        focusedCanvas().setState({
            nodes: { a: node('a', 0, 0), b: node('b', 300, 0) },
            texts: {},
            order: ['a', 'b'],
            selection: [],
            bodyFocusId: null,
            edges: [],
            viewId: 'main'
        });
    };

    test('shift-clicking a node that is already selected takes it out again', () => {
        two();
        canvas().select(['a']);
        canvas().select(['b'], true);
        expect(canvas().selection).toEqual(['a', 'b']);

        canvas().select(['a'], true);
        expect(canvas().selection).toEqual(['b']);
    });

    test('a box drawn with shift only ever adds, so dragging over the selection never clears it', () => {
        two();
        canvas().select(['a']);
        canvas().selectInRect({ x: -1000, y: -1000, w: 4000, h: 4000 }, true);
        expect(canvas().selection).toEqual(['a', 'b']);
    });

    test('activateNode selects a node, puts it on top and hands it the keyboard', () => {
        two();
        canvas().activateNode('a');
        expect(canvas().selection).toEqual(['a']);
        expect(canvas().order).toEqual(['b', 'a']);
        expect(isNodeActive(canvas().bodyFocusId, 'a')).toBe(true);
    });

    test('selecting is not focusing: a node picked up to be moved stays untouched', () => {
        two();
        canvas().select(['a']);
        expect(canvas().bodyFocusId).toBeNull();
        expect(isNodeActive(canvas().bodyFocusId, 'a')).toBe(false);

        canvas().activateNode('a');
        canvas().select(['b']);
        // Selecting elsewhere leaves the keyboard where it is; the canvas hands it back on the press.
        expect(canvas().bodyFocusId).toBe('a');
        canvas().setBodyFocus(null);
        expect(isNodeActive(canvas().bodyFocusId, 'a')).toBe(false);
    });

    test('a node that goes away takes the keyboard with it', () => {
        two();
        canvas().activateNode('a');
        canvas().select(['a']);
        canvas().deleteSelected();
        expect(canvas().bodyFocusId).toBeNull();
    });
});

describe('text elements', () => {
    test('a new text has no style of its own and keeps what it is given through a save', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = canvas().addText({ x: 40, y: 40 });
        expect(canvas().texts[id]).toMatchObject({ text: '', size: 18 });
        expect(canvas().texts[id]!.font).toBeUndefined();

        canvas().updateText(id, 'Milestone');
        canvas().styleText(id, { font: 'hand', bold: true, size: 28 });
        expect(canvas().exportContent().texts).toEqual([{ id, x: 40, y: 40, text: 'Milestone', size: 28, font: 'hand', bold: true }]);

        canvas().styleText(id, { bold: false });
        expect(canvas().texts[id]).toMatchObject({ bold: false, font: 'hand' });
    });

    test('text layout and decorations survive schema validation and undo', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = canvas().addText({ x: 40, y: 40 });
        canvas().updateText(id, 'A long label\nwith two lines');
        const style = { underline: true, strikethrough: true, align: 'center' as const, maxWidth: 240, color: 'violet' };
        canvas().styleText(id, style);
        const saved = ProjectCanvasViewSchema.parse({ ...canvas().exportContent(), kind: 'canvas', id: 'main', name: 'Canvas' });
        expect(saved.texts[0]).toMatchObject(style);
        canvas().styleText(id, { maxWidth: undefined, align: 'right', underline: false });
        expect(canvas().texts[id]!.maxWidth).toBeUndefined();
        canvas().undo();
        expect(canvas().texts[id]).toMatchObject(style);
    });

    test('resizing text records the whole drag as one undo step', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = canvas().addText({ x: 40, y: 40 });
        canvas().updateText(id, 'A label');
        canvas().styleText(id, { color: 'blue' });
        canvas().resizeText(id, 20, 240);
        canvas().resizeText(id, -20, 280, false);
        canvas().resizeText(id, -60, 320, false);
        expect(canvas().texts[id]).toMatchObject({ x: -60, maxWidth: 320 });
        canvas().undo();
        expect(canvas().texts[id]!.maxWidth).toBeUndefined();
        expect(canvas().texts[id]).toMatchObject({ x: 40, color: 'blue' });
        canvas().redo();
        expect(canvas().texts[id]).toMatchObject({ x: -60, maxWidth: 320 });
        canvas().styleText(id, { color: undefined });
        expect(canvas().texts[id]!.color).toBeUndefined();
    });

    test('styling a text that is gone changes nothing', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const before = canvas().texts;
        canvas().styleText('text-gone', { italic: true });
        expect(canvas().texts).toBe(before);
    });
});

describe('another writer and the history', () => {
    const view = (nodes: CanvasNode[], edges: ProjectCanvasView['edges'] = []): ProjectCanvasView => ({
        kind: 'canvas',
        id: 'main',
        name: 'main',
        nodes,
        texts: [],
        edges,
        layouts: []
    });
    const patch = (changes: Partial<CanvasPatch>): CanvasPatch => ({
        nodes: [],
        texts: [],
        edges: [],
        removed: { nodes: [], texts: [], edges: [] },
        order: [],
        layouts: null,
        ...changes
    });
    const editorWith = (nodes: CanvasNode[], edges: ProjectCanvasView['edges'] = []) => {
        const editor = createCanvasStore();
        editor.getState().loadView(view(nodes, edges), null);
        return editor;
    };

    test('an undo after a node another writer added keeps that node, and puts back only my own move', () => {
        const editor = editorWith([node('mine', 0, 0)]);
        editor.getState().select(['mine']);
        editor.getState().moveSelected(40, 0, true);

        editor.getState().applyExternal(patch({ nodes: [node('child', 400, 0)], order: ['mine', 'child'] }));
        editor.getState().undo();

        expect(editor.getState().nodes.mine).toMatchObject({ x: 0 });
        expect(editor.getState().nodes.child).toMatchObject({ x: 400 });
        expect(editor.getState().order).toEqual(['mine', 'child']);

        editor.getState().redo();
        expect(editor.getState().nodes.mine).toMatchObject({ x: 40 });
        expect(editor.getState().order).toEqual(['mine', 'child']);
    });

    test('an undo after a node another writer deleted brings nothing of it back, its lines included', () => {
        const editor = editorWith([node('mine', 0, 0), node('gone', 400, 0)], [{ id: 'line', from: 'mine', to: 'gone' }]);
        editor.getState().select(['mine']);
        editor.getState().moveSelected(40, 0, true);

        editor.getState().applyExternal(patch({ removed: { nodes: ['gone'], texts: [], edges: [] }, order: ['mine'] }));
        editor.getState().undo();

        expect(editor.getState().nodes.mine).toMatchObject({ x: 0 });
        expect(editor.getState().nodes.gone).toBeUndefined();
        expect(editor.getState().order).toEqual(['mine']);
        expect(editor.getState().edges).toEqual([]);
    });

    test('a node I deleted myself comes back on undo after another writer changed something else', () => {
        const editor = editorWith([node('mine', 0, 0), node('other', 400, 0)]);
        editor.getState().select(['mine']);
        editor.getState().deleteSelected();

        editor.getState().applyExternal(patch({ nodes: [node('other', 800, 0)], order: ['other'] }));
        editor.getState().undo();

        expect(editor.getState().nodes.mine).toMatchObject({ x: 0 });
        // What the step already held keeps its own fields, whatever came in since.
        expect(editor.getState().nodes.other).toMatchObject({ x: 400 });
    });

    test('a change that only moves fields leaves the history untouched', () => {
        const editor = editorWith([node('mine', 0, 0), node('other', 400, 0)]);
        editor.getState().select(['mine']);
        editor.getState().moveSelected(40, 0, true);
        const past = editor.getState().past;

        editor.getState().applyExternal(patch({ nodes: [node('other', 800, 0)], order: ['mine', 'other'] }));

        expect(editor.getState().past).toBe(past);
    });

    test('taking in a change is a merge and not a load', () => {
        const editor = editorWith([node('mine', 0, 0)]);
        const seen: [boolean, boolean][] = [];
        editor.subscribe((state) => seen.push([state.loading, state.merging]));

        editor.getState().applyExternal(patch({ removed: { nodes: ['mine'], texts: [], edges: [] } }));

        expect(seen).toEqual([
            [false, true],
            [false, false]
        ]);
    });
});

describe('patchSnapshot', () => {
    test('adds what is new, drops what is gone and leaves the fields of what it holds', () => {
        const snapshot = {
            nodes: { kept: node('kept', 0, 0), gone: node('gone', 0, 0) },
            order: ['kept', 'gone'],
            texts: { note: { id: 'note', x: 0, y: 0, text: 'hi', size: 18 } },
            edges: [
                { id: 'into-gone', from: 'kept', to: 'gone' },
                { id: 'removed', from: 'kept', to: 'note' }
            ],
            layouts: []
        };
        const patched = patchSnapshot(snapshot, {
            nodes: [node('kept', 900, 900), node('fresh', 10, 10)],
            texts: [],
            edges: [{ id: 'new-line', from: 'kept', to: 'fresh' }],
            removed: { nodes: ['gone'], texts: [], edges: ['removed'] },
            order: ['kept', 'fresh'],
            layouts: null
        });

        expect(patched.nodes.kept).toMatchObject({ x: 0 });
        expect(Object.keys(patched.nodes).sort()).toEqual(['fresh', 'kept']);
        expect(patched.order).toEqual(['kept', 'fresh']);
        expect(patched.edges.map((edge) => edge.id)).toEqual(['new-line']);
        expect(snapshot.order).toEqual(['kept', 'gone']);
    });
});
