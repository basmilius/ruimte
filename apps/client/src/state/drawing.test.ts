import { beforeEach, describe, expect, test } from 'bun:test';
import type { DrawingDocument, DrawingElement } from '@ruimte/contracts';
import { useDrawing } from './drawing';

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

const ids = (): string[] => useDrawing.getState().elements.map((element) => element.id);

beforeEach(() => {
    useDrawing.getState().setViewport({ w: 800, h: 600 });
    useDrawing.getState().load('view-1', document([rect('a'), rect('b', 200)]), { camera: { x: 10, y: 20, zoom: 1 }, focusedNodeId: null });
});

describe('loading', () => {
    test('the stored camera wins and the history starts empty', () => {
        expect(useDrawing.getState().camera).toEqual({ x: 10, y: 20, zoom: 1 });
        expect(useDrawing.getState().past).toEqual([]);
        expect(useDrawing.getState().rev).toBe(3);
        expect(useDrawing.getState().dirty).toBe(false);
    });

    test('without a stored camera the elements are fitted into view', () => {
        useDrawing.getState().load('view-1', document([rect('a', 4000, 4000)]), null);
        expect(useDrawing.getState().camera).not.toEqual({ x: 10, y: 20, zoom: 1 });
    });

    test('unloading empties the drawing without touching the camera', () => {
        const { camera } = useDrawing.getState();
        useDrawing.getState().unload();
        expect(useDrawing.getState().elements).toEqual([]);
        expect(useDrawing.getState().viewId).toBeNull();
        expect(useDrawing.getState().camera).toEqual(camera);
    });
});

describe('history', () => {
    test('a drag is one entry: the first step remembers, the rest do not', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().moveSelected(10, 0, true);
        useDrawing.getState().moveSelected(10, 0, false);
        useDrawing.getState().moveSelected(10, 0, false);
        expect(useDrawing.getState().past).toHaveLength(1);
        useDrawing.getState().undo();
        expect(useDrawing.getState().elements[0]).toMatchObject({ id: 'a', x: 0 });
    });

    test('undo and redo restore the elements, clear the selection and leave the camera alone', () => {
        const camera = useDrawing.getState().camera;
        useDrawing.getState().select(['a']);
        useDrawing.getState().deleteSelected();
        expect(ids()).toEqual(['b']);
        useDrawing.getState().undo();
        expect(ids()).toEqual(['a', 'b']);
        expect(useDrawing.getState().selection).toEqual([]);
        expect(useDrawing.getState().camera).toEqual(camera);
        useDrawing.getState().redo();
        expect(ids()).toEqual(['b']);
    });

    test('an edit after an undo clears what could be redone', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().deleteSelected();
        useDrawing.getState().undo();
        expect(useDrawing.getState().future).toHaveLength(1);
        useDrawing.getState().addElement(rect('c', 400));
        expect(useDrawing.getState().future).toEqual([]);
    });

    test('every edit counts, which is what the client saves on', () => {
        const before = useDrawing.getState().edits;
        useDrawing.getState().addElement(rect('c'));
        expect(useDrawing.getState().edits).toBe(before + 1);
    });
});

describe('drawing and erasing', () => {
    test('a draft is nothing until it is committed', () => {
        useDrawing.getState().beginDraft(rect('draft', 10, 10));
        expect(useDrawing.getState().edits).toBe(0);
        useDrawing.getState().updateDraft({ w: 300 });
        expect(useDrawing.getState().commitDraft()).toBe('draft');
        expect(ids()).toEqual(['a', 'b', 'draft']);
        expect(useDrawing.getState().selection).toEqual(['draft']);
        expect(useDrawing.getState().elements.at(-1)).toMatchObject({ w: 300 });
    });

    test('a cancelled draft leaves no trace', () => {
        useDrawing.getState().beginDraft(rect('draft'));
        useDrawing.getState().cancelDraft();
        expect(ids()).toEqual(['a', 'b']);
        expect(useDrawing.getState().edits).toBe(0);
    });

    test('an eraser drag is one undo step', () => {
        useDrawing.getState().beginErase();
        useDrawing.getState().eraseElement('a');
        useDrawing.getState().eraseElement('a');
        useDrawing.getState().eraseElement('b');
        expect(ids()).toEqual(['a', 'b']);
        useDrawing.getState().commitErase();
        expect(ids()).toEqual([]);
        useDrawing.getState().undo();
        expect(ids()).toEqual(['a', 'b']);
    });
});

describe('the selection', () => {
    test('a locked element cannot be selected, moved or erased', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().toggleLockSelected();
        expect(useDrawing.getState().selection).toEqual([]);
        useDrawing.getState().selectAll();
        expect(useDrawing.getState().selection).toEqual(['b']);
        useDrawing.getState().select(['a', 'b']);
        useDrawing.getState().deleteSelected();
        expect(ids()).toEqual(['a']);
    });

    test('a duplicate lands offset, with a new id and its own seed', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().duplicateSelected();
        const copy = useDrawing.getState().elements.at(-1)!;
        expect(copy.id).not.toBe('a');
        expect(copy).toMatchObject({ x: 16, y: 16 });
        expect(useDrawing.getState().selection).toEqual([copy.id]);
    });

    test('z-order moves the selection to the front and to the back', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().bringToFront();
        expect(ids()).toEqual(['b', 'a']);
        useDrawing.getState().sendToBack();
        expect(ids()).toEqual(['a', 'b']);
    });

    test('a style choice paints the selection and stays for the next element', () => {
        useDrawing.getState().select(['a']);
        useDrawing.getState().setStyle({ stroke: 'red', strokeWidth: 4 });
        expect(useDrawing.getState().elements[0]).toMatchObject({ stroke: 'red', strokeWidth: 4 });
        expect(useDrawing.getState().elements[1]).toMatchObject({ stroke: 'ink' });
        expect(useDrawing.getState().style).toMatchObject({ stroke: 'red', strokeWidth: 4 });
    });
});

describe('text', () => {
    test('an empty text takes itself off the drawing', () => {
        useDrawing.getState().addElement(text('t1'));
        useDrawing.getState().updateText('t1', '');
        expect(ids()).toEqual(['a', 'b']);
    });

    test('a text keeps its size unless the size itself is chosen', () => {
        useDrawing.getState().addElement(text('t1'));
        useDrawing.getState().select(['t1']);
        useDrawing.getState().setStyle({ stroke: 'blue' });
        expect(useDrawing.getState().elements.at(-1)).toMatchObject({ size: 20, stroke: 'blue' });
        useDrawing.getState().setStyle({ textSize: 36 });
        expect(useDrawing.getState().elements.at(-1)).toMatchObject({ size: 36 });
    });
});

describe('the tool', () => {
    test('a shape falls back to select, freehand stays, and Q keeps whatever is up', () => {
        useDrawing.getState().setTool('rect');
        useDrawing.getState().settleTool();
        expect(useDrawing.getState().tool).toBe('select');
        useDrawing.getState().setTool('freehand');
        useDrawing.getState().settleTool();
        expect(useDrawing.getState().tool).toBe('freehand');
        useDrawing.getState().toggleToolLock();
        useDrawing.getState().setTool('ellipse');
        useDrawing.getState().settleTool();
        expect(useDrawing.getState().tool).toBe('ellipse');
    });
});

describe('a document that comes in from disk', () => {
    test('it replaces the elements, keeps the camera and what survives of the selection', () => {
        const camera = useDrawing.getState().camera;
        useDrawing.getState().select(['a', 'b']);
        useDrawing.getState().applyDocument(document([rect('b', 500)], 9));
        expect(ids()).toEqual(['b']);
        expect(useDrawing.getState().selection).toEqual(['b']);
        expect(useDrawing.getState().camera).toEqual(camera);
        expect(useDrawing.getState().rev).toBe(9);
        expect(useDrawing.getState().dirty).toBe(false);
        expect(useDrawing.getState().past).toEqual([]);
    });
});
