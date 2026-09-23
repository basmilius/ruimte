import { beforeEach, describe, expect, test } from 'bun:test';
import type { DrawingDocument, DrawingElement } from '@ruimte/contracts';
import { boundsOf, createDrawingStore, focusedDrawing, withStyle } from './drawing';

/* Every test here is about one editor, and with no workspace open that is the module's own. */
const drawing = () => focusedDrawing().getState();

const rect = (id: string, x = 0, y = 0): DrawingElement => ({ kind: 'rect', id, x, y, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 });

const text = (id: string, value = 'hello'): DrawingElement => ({
    kind: 'text',
    id,
    x: 0,
    y: 0,
    w: 80,
    h: 24,
    stroke: 'ink',
    strokeWidth: 1,
    seed: 2,
    text: value,
    size: 20
});

const document = (elements: DrawingElement[], rev = 3): DrawingDocument => ({ version: 1, rev, elements });

const ids = (): string[] => drawing().elements.map((element) => element.id);

beforeEach(() => {
    drawing().setViewport({ w: 800, h: 600 });
    drawing().load('view-1', document([rect('a'), rect('b', 200)]), { camera: { center: { x: 390, y: 280 }, zoom: 1 }, focusedNodeId: null });
});

describe('bounds', () => {
    /* A line drawn to the left or upwards keeps its start in (x, y) and carries a negative size. */
    const line = (id: string, w: number, h: number): DrawingElement => ({
        kind: 'line',
        id,
        x: 300,
        y: 200,
        w,
        h,
        stroke: 'ink',
        strokeWidth: 2,
        seed: 3,
        points: [
            [0, 0],
            [w, h]
        ]
    });

    test('an arrow drawn to the left is bounded where it is drawn, the way the export reads it', () => {
        expect(boundsOf([line('l', -200, -100)])).toEqual({ x: 100, y: 100, w: 200, h: 100 });
        expect(boundsOf([rect('a'), line('l', -200, -100)])).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    });

    test('nothing has no bounds', () => {
        expect(boundsOf([])).toBeNull();
    });
});

describe('loading', () => {
    test('the stored camera wins and the history starts empty', () => {
        expect(drawing().camera).toEqual({ x: 10, y: 20, zoom: 1 });
        expect(drawing().past).toEqual([]);
        expect(drawing().rev).toBe(3);
        expect(drawing().dirty).toBe(false);
    });

    test('without a stored camera the elements are fitted into view', () => {
        drawing().load('view-1', document([rect('a', 4000, 4000)]), null);
        expect(drawing().camera).not.toEqual({ x: 10, y: 20, zoom: 1 });
    });

    test('a drawing without a size waits with its stored camera, and fits once when it has none', () => {
        const stored = { center: { x: 50, y: 30 }, zoom: 2 };
        const waiting = createDrawingStore();
        waiting.getState().load('view-1', document([rect('a')]), { camera: stored, focusedNodeId: null });
        expect(waiting.getState().viewCamera()).toBe(stored);
        waiting.getState().setViewport({ w: 400, h: 300 });
        expect(waiting.getState().pendingCamera).toBeNull();
        expect(waiting.getState().camera).toEqual({ x: 100, y: 90, zoom: 2 });

        const fitting = createDrawingStore();
        fitting.getState().load('view-1', document([rect('a', 4000, 4000)]), null);
        expect(fitting.getState().pendingCamera).toEqual({ kind: 'fit' });
        fitting.getState().setViewport({ w: 800, h: 600 });
        fitting.getState().panBy(10, 10);
        const moved = fitting.getState().camera;
        fitting.getState().setViewport({ w: 700, h: 500 });
        expect(fitting.getState().camera).toEqual(moved);
    });

    test('unloading empties the drawing without touching the camera', () => {
        const { camera } = drawing();
        drawing().unload();
        expect(drawing().elements).toEqual([]);
        expect(drawing().viewId).toBeNull();
        expect(drawing().camera).toEqual(camera);
    });
});

describe('history', () => {
    test('a drag is one entry: the first step remembers, the rest do not', () => {
        drawing().select(['a']);
        drawing().moveSelected(10, 0, true);
        drawing().moveSelected(10, 0, false);
        drawing().moveSelected(10, 0, false);
        expect(drawing().past).toHaveLength(1);
        drawing().undo();
        expect(drawing().elements[0]).toMatchObject({ id: 'a', x: 0 });
    });

    test('undo and redo restore the elements, clear the selection and leave the camera alone', () => {
        const camera = drawing().camera;
        drawing().select(['a']);
        drawing().replaceElements([rect('b', 200)]);
        expect(ids()).toEqual(['b']);
        drawing().undo();
        expect(ids()).toEqual(['a', 'b']);
        expect(drawing().selection).toEqual([]);
        expect(drawing().camera).toEqual(camera);
        drawing().redo();
        expect(ids()).toEqual(['b']);
    });

    test('an edit after an undo clears what could be redone', () => {
        drawing().replaceElements([rect('b', 200)]);
        drawing().undo();
        expect(drawing().future).toHaveLength(1);
        drawing().addElement(rect('c', 400));
        expect(drawing().future).toEqual([]);
    });

    test('every edit counts, which is what the client saves on', () => {
        const before = drawing().edits;
        drawing().addElement(rect('c'));
        expect(drawing().edits).toBe(before + 1);
    });
});

describe('drawing and erasing', () => {
    test('a draft is nothing until it is committed', () => {
        drawing().beginDraft(rect('draft', 10, 10));
        expect(drawing().edits).toBe(0);
        drawing().updateDraft({ w: 300 });
        expect(drawing().commitDraft()).toBe('draft');
        expect(ids()).toEqual(['a', 'b', 'draft']);
        expect(drawing().selection).toEqual(['draft']);
        expect(drawing().elements.at(-1)).toMatchObject({ w: 300 });
    });

    test('a cancelled draft leaves no trace', () => {
        drawing().beginDraft(rect('draft'));
        drawing().cancelDraft();
        expect(ids()).toEqual(['a', 'b']);
        expect(drawing().edits).toBe(0);
    });

    test('an eraser drag is one undo step', () => {
        drawing().beginErase();
        drawing().eraseElement('a');
        drawing().eraseElement('a');
        drawing().eraseElement('b');
        expect(ids()).toEqual(['a', 'b']);
        drawing().commitErase();
        expect(ids()).toEqual([]);
        drawing().undo();
        expect(ids()).toEqual(['a', 'b']);
    });
});

describe('the selection', () => {
    test('a locked element cannot be selected by hand or by a box', () => {
        drawing().replaceElements([{ ...rect('a'), locked: true }, rect('b', 200)]);
        drawing().selectAll();
        expect(drawing().selection).toEqual(['b']);
        drawing().selectInRect({ x: -10, y: -10, w: 400, h: 100 });
        expect(drawing().selection).toEqual(['b']);
    });
});

describe('text', () => {
    test('an empty text takes itself off the drawing', () => {
        drawing().addElement(text('t1'));
        drawing().updateText('t1', '');
        expect(ids()).toEqual(['a', 'b']);
    });

    test('a text keeps its size unless the size itself is chosen', () => {
        expect(withStyle(text('t1'), { stroke: 'blue' })).toMatchObject({ size: 20, stroke: 'blue' });
        expect(withStyle(text('t1'), { textSize: 36 })).toMatchObject({ size: 36 });
    });

    test('a style writes only the chosen field, not the color the dock happens to show', () => {
        expect(withStyle(rect('a'), { strokeWidth: 4 })).toMatchObject({ stroke: 'ink', strokeWidth: 4 });
    });
});

describe('the tool', () => {
    test('a shape falls back to select, freehand stays, and Q keeps whatever is up', () => {
        drawing().setTool('rect');
        drawing().settleTool();
        expect(drawing().tool).toBe('select');
        drawing().setTool('freehand');
        drawing().settleTool();
        expect(drawing().tool).toBe('freehand');
        drawing().toggleToolLock();
        drawing().setTool('ellipse');
        drawing().settleTool();
        expect(drawing().tool).toBe('ellipse');
    });
});

describe('a document that comes in from disk', () => {
    test('it replaces the elements, keeps the camera and what survives of the selection', () => {
        const camera = drawing().camera;
        drawing().select(['a', 'b']);
        drawing().applyDocument(document([rect('b', 500)], 9));
        expect(ids()).toEqual(['b']);
        expect(drawing().selection).toEqual(['b']);
        expect(drawing().camera).toEqual(camera);
        expect(drawing().rev).toBe(9);
        expect(drawing().dirty).toBe(false);
        expect(drawing().past).toEqual([]);
    });
});
