import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ActionRegistry, ActionResult } from '@ruimte/actions';
import type { DrawingElement, ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import type { ContentMachine } from './content-actions';
import { defaultCanvases } from '@/state/canvas';
import { defaultDiagrams } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { defaultDrawings } from '@/state/drawing';

const main: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [
        { id: 'memo', kind: 'note', title: 'Memo', x: 0, y: 0, w: 240, h: 160, body: 'Buy milk' },
        { id: 'shell', kind: 'terminal', title: 'Shell', x: 400, y: 0, w: 400, h: 300 }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const document: ProjectDocument = { version: 3, rev: 1, name: 'Atlas', color: '#000', views: [main] };

const rect = (id: string, x = 0, patch: Partial<DrawingElement> = {}): DrawingElement =>
    ({ kind: 'rect', id, x, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1, ...patch }) as DrawingElement;

/* The clipboard, the save dialog and the painters, as a log of what reached them. */
const fakes = () => {
    const log: string[] = [];
    const machine: Partial<ContentMachine> = {
        writeText: async (text) => void log.push(`text:${text}`),
        writePng: async () => void log.push('png'),
        save: async (_blob, name, mime) => void log.push(`save:${name.replace(/\d{4}-\d{2}-\d{2}/, 'DAY')}:${mime}`),
        drawingPng: async () => new Blob(['png']),
        drawingSvg: () => '<svg>drawing</svg>',
        diagramPng: async () => new Blob(['png']),
        diagramSvg: () => '<svg>diagram</svg>'
    };
    return { log, registry: createClientActionRegistry(useDocument, { content: machine }) };
};

const completed = <Result extends ActionResult>(result: Result): Extract<Result, { status: 'completed' }> => {
    if (result.status !== 'completed') {
        throw new Error(`Expected a completed action, got ${JSON.stringify(result)}`);
    }
    return result as Extract<Result, { status: 'completed' }>;
};

const confirmed = async (registry: ActionRegistry<void>, asked: ActionResult) => {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${asked.status}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
};

const canvas = () => defaultCanvases.of('main').getState();

let drawingId = '';
let diagramId = '';
const drawing = () => defaultDrawings.of(drawingId).getState();
const diagram = () => defaultDiagrams.of(diagramId).getState();
const ids = () => drawing().elements.map((element) => element.id);

beforeEach(() => {
    useDocument.getState().load(document, { activeViewId: 'main', views: {} });
    defaultCanvases.of('main').getState().loadView(main, null);
    defaultCanvases.focus('main');
    drawingId = useDocument.getState().addDrawingView('Sketch')!;
    diagramId = useDocument.getState().addDiagramView('Flow')!;
    useDocument.getState().showView('main');
});

afterEach(() => {
    defaultDrawings.release(drawingId);
    defaultDiagrams.release(diagramId);
    useDocument.getState().load(null, null);
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

/* The drawing beside the canvas, in a cell of its own, holding two rectangles and a locked third. */
const showDrawing = () => {
    useDocument.getState().splitFocused('right', drawingId);
    drawing().load(drawingId, { version: 1, rev: 2, elements: [rect('a'), rect('b', 200), rect('c', 400, { locked: true })] }, null);
};

const showDiagram = () => {
    useDocument.getState().splitFocused('right', diagramId);
    diagram().load(
        diagramId,
        {
            version: 1,
            rev: 4,
            meta: { title: 'Wire', direction: 'right' },
            nodes: [
                { id: 'client', label: 'Client', pos: [10, 10] },
                { id: 'server', label: 'Server' }
            ],
            groups: [],
            edges: [{ from: 'client', to: 'server', label: 'http' }]
        },
        null
    );
};

describe('notes', () => {
    test('Voice reads a note, writes over it, adds a line under it, and undo takes back exactly its own write', async () => {
        const { registry } = fakes();
        expect(completed(await registry.execute('note.read', { viewId: 'main', nodeId: 'memo' }, VOICE_ACTION_CALL)).output).toMatchObject({
            note: 'Memo',
            text: 'Buy milk',
            truncated: false
        });
        const appended = completed(
            await registry.execute('node.update', { viewId: 'main', nodeId: 'memo', text: 'Call Fleur', append: true }, VOICE_ACTION_CALL)
        );
        expect(appended.output).toEqual({ viewId: 'main', nodeId: 'memo', lines: 2, characters: 19, changed: true });
        expect(canvas().nodes.memo?.body).toBe('Buy milk\nCall Fleur');
        expect(await registry.undo(appended.undoToken!, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(canvas().nodes.memo?.body).toBe('Buy milk');
    });

    test('an undo after the person typed on is refused and leaves what they wrote', async () => {
        const { registry } = fakes();
        const written = completed(await registry.execute('node.update', { viewId: 'main', nodeId: 'memo', text: 'Plan', append: false }, VOICE_ACTION_CALL));
        canvas().updateNode('memo', { body: 'Plan and more' });
        expect(await registry.undo(written.undoToken!, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'stale-undo' } });
        expect(canvas().nodes.memo?.body).toBe('Plan and more');
    });

    test('writing the same words is no change and leaves no undo; a terminal is not a note', async () => {
        const { registry } = fakes();
        const same = completed(await registry.execute('node.update', { viewId: 'main', nodeId: 'memo', text: 'Buy milk', append: false }, PERSON_ACTION_CALL));
        expect(same.output.changed).toBe(false);
        expect(same.undoToken).toBeUndefined();
        expect(await registry.execute('node.update', { viewId: 'main', nodeId: 'shell', text: 'ls', append: false }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'not-a-note' }
        });
    });
});

describe('drawings', () => {
    test('a drawing on no cell is refused, not written behind the file', async () => {
        const { registry } = fakes();
        expect(await registry.execute('drawing.read', { viewId: drawingId }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'inactive-view' }
        });
    });

    test('Voice draws finished shapes in the dock style as one step, and undo takes all of them back', async () => {
        showDrawing();
        const { registry } = fakes();
        const drawn = completed(
            await registry.execute(
                'drawing.addElements',
                {
                    viewId: drawingId,
                    elements: [
                        { kind: 'ellipse', x: 50, y: 50, w: -40, h: 30, text: null, color: 'red' },
                        { kind: 'arrow', x: 0, y: 0, w: 120, h: -40, text: null, color: null },
                        { kind: 'note', x: 300, y: 300, w: 180, h: 180, text: 'Ship it', color: 'green' }
                    ],
                    copies: null
                },
                VOICE_ACTION_CALL
            )
        );
        expect(drawn.output.elementIds).toHaveLength(3);
        const [ellipse, arrow, note] = drawing().elements.slice(-3);
        expect(ellipse).toMatchObject({ kind: 'ellipse', x: 10, w: 40, stroke: 'red', strokeWidth: 2 });
        expect(arrow).toMatchObject({
            kind: 'line',
            arrowEnd: true,
            points: [
                [0, 0],
                [120, -40]
            ]
        });
        expect(note).toMatchObject({ kind: 'note', text: 'Ship it', fillColor: 'green' });
        expect(drawing().selection).toEqual(drawn.output.elementIds);
        expect(drawing().past).toHaveLength(1);
        expect(await registry.undo(drawn.undoToken!, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(ids()).toEqual(['a', 'b', 'c']);
    });

    test('a paste is a person’s: the copies arrive under new ids a step aside, and Voice may not hand any in', async () => {
        showDrawing();
        const { registry } = fakes();
        const pasted = completed(
            await registry.execute('drawing.addElements', { viewId: drawingId, elements: null, copies: [rect('a', 0)] }, PERSON_ACTION_CALL)
        );
        expect(drawing().elements.at(-1)).toMatchObject({ x: 16, y: 16 });
        expect(pasted.output.elementIds[0]).not.toBe('a');
        expect(await registry.execute('drawing.addElements', { viewId: drawingId, elements: null, copies: [rect('a')] }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
    });

    test('a change restyles, moves and rewrites what it names, and leaves a locked element as it is', async () => {
        showDrawing();
        const { registry } = fakes();
        const style = {
            stroke: 'blue',
            fill: null,
            fillColor: null,
            noteColor: null,
            strokeWidth: 4,
            strokeStyle: null,
            roughness: null,
            font: null,
            textSize: null,
            align: null
        } as const;
        const changed = completed(
            await registry.execute('drawing.updateElements', { viewId: drawingId, elementIds: ['a', 'c'], style, text: null, dx: 5, dy: -5 }, VOICE_ACTION_CALL)
        );
        expect(changed.output.elementIds).toEqual(['a']);
        expect(drawing().elements[0]).toMatchObject({ stroke: 'blue', strokeWidth: 4, x: 5, y: -5 });
        expect(drawing().elements[2]).toMatchObject({ stroke: 'ink', x: 400 });
        // Only the field that was chosen is written, so the style the dock shows elsewhere stays off it.
        expect(drawing().elements[0]).not.toHaveProperty('fill');
        expect(drawing().style.stroke).toBe('ink');
    });

    test('a person’s style with nothing selected only sets what the next element is drawn with', async () => {
        showDrawing();
        const { registry } = fakes();
        const style = {
            stroke: 'red',
            fill: null,
            fillColor: null,
            noteColor: null,
            strokeWidth: null,
            strokeStyle: null,
            roughness: null,
            font: null,
            textSize: null,
            align: null
        } as const;
        const result = completed(
            await registry.execute('drawing.updateElements', { viewId: drawingId, elementIds: null, style, text: null, dx: null, dy: null }, PERSON_ACTION_CALL)
        );
        expect(result.output.elementIds).toEqual([]);
        expect(drawing().style.stroke).toBe('red');
        expect(drawing().past).toHaveLength(0);
        expect(
            await registry.execute('drawing.updateElements', { viewId: drawingId, elementIds: null, style: null, text: null, dx: 1, dy: 0 }, PERSON_ACTION_CALL)
        ).toMatchObject({ status: 'failed', error: { code: 'nothing-selected' } });
    });

    test('deleting what is selected keeps a locked element, and an undo after a later edit is refused', async () => {
        showDrawing();
        const { registry } = fakes();
        drawing().select(['a', 'c']);
        const deleted = completed(await registry.execute('drawing.deleteElements', { viewId: drawingId, elementIds: null }, VOICE_ACTION_CALL));
        expect(deleted.output.elementIds).toEqual(['a']);
        expect(ids()).toEqual(['b', 'c']);
        drawing().replaceElements([rect('b', 200)]);
        expect(await registry.undo(deleted.undoToken!, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'stale-undo' } });
        expect(ids()).toEqual(['b']);
    });

    test('duplicates land a step aside and are selected; z-order and locks are single steps', async () => {
        showDrawing();
        const { registry } = fakes();
        const copies = completed(await registry.execute('drawing.duplicateElements', { viewId: drawingId, elementIds: ['b'] }, VOICE_ACTION_CALL));
        expect(drawing().elements.at(-1)).toMatchObject({ x: 216, y: 16 });
        expect(drawing().selection).toEqual(copies.output.elementIds);
        await registry.execute('drawing.reorderElements', { viewId: drawingId, elementIds: ['a'], to: 'front' }, PERSON_ACTION_CALL);
        expect(ids().at(-1)).toBe('a');
        await registry.execute('drawing.reorderElements', { viewId: drawingId, elementIds: ['a'], to: 'back' }, PERSON_ACTION_CALL);
        expect(ids()[0]).toBe('a');
        drawing().select(['a']);
        const locked = completed(await registry.execute('drawing.lockElements', { viewId: drawingId, elementIds: null, locked: true }, PERSON_ACTION_CALL));
        expect(drawing().elements[0]).toMatchObject({ locked: true });
        expect(drawing().selection).toEqual([]);
        await registry.undo(locked.undoToken!, PERSON_ACTION_CALL);
        expect(drawing().elements[0]).not.toHaveProperty('locked');
        expect(await registry.execute('drawing.lockElements', { viewId: drawingId, elementIds: ['nope'], locked: false }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-element' }
        });
    });

    test('replacing a whole drawing asks Voice first and names what goes; undo brings it back', async () => {
        showDrawing();
        const { registry } = fakes();
        const json = JSON.stringify({ elements: [rect('z', 30)] });
        const asked = await registry.execute('drawing.replaceContent', { viewId: drawingId, document: json }, VOICE_ACTION_CALL);
        expect(asked).toMatchObject({
            status: 'needs_confirmation',
            confirmation: {
                title: 'Replace everything in the drawing “Sketch”?',
                consequences: ['The 3 elements it holds now are replaced by 1 element.', expect.any(String)]
            }
        });
        expect(ids()).toEqual(['a', 'b', 'c']);
        const replaced = completed(await confirmed(registry, asked));
        expect(ids()).toEqual(['z']);
        expect(await registry.undo(replaced.undoToken!, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(ids()).toEqual(['a', 'b', 'c']);
        expect(await registry.execute('drawing.replaceContent', { viewId: drawingId, document: '{"elements": [' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'bad-json' }
        });
        expect(
            await registry.execute(
                'drawing.replaceContent',
                { viewId: drawingId, document: JSON.stringify({ elements: [rect('z'), rect('z')] }) },
                PERSON_ACTION_CALL
            )
        ).toMatchObject({ status: 'failed', error: { code: 'bad-document' } });
    });

    test('copying goes to the clipboard for anyone; saving a file is a person’s', async () => {
        showDrawing();
        const { log, registry } = fakes();
        completed(await registry.execute('drawing.copy', { viewId: drawingId, format: 'png' }, VOICE_ACTION_CALL));
        completed(await registry.execute('drawing.copy', { viewId: drawingId, format: 'svg' }, VOICE_ACTION_CALL));
        expect(await registry.execute('drawing.copy', { viewId: drawingId, format: 'elements' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'nothing-selected' }
        });
        drawing().select(['b']);
        expect(completed(await registry.execute('drawing.copy', { viewId: drawingId, format: 'elements' }, PERSON_ACTION_CALL)).output.elements).toBe(1);
        expect(await registry.execute('drawing.export', { viewId: drawingId, format: 'png' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        completed(await registry.execute('drawing.export', { viewId: drawingId, format: 'svg' }, PERSON_ACTION_CALL));
        expect(log).toEqual([
            'png',
            'text:<svg>drawing</svg>',
            expect.stringContaining('text:{"type":"application/x-ruimte-drawing","elements":[{"kind":"rect","id":"b"'),
            'save:drawing-DAY.svg:image/svg+xml'
        ]);
    });
});

describe('diagrams', () => {
    test('Voice reads a diagram, renames and recolors a node in one step, and gives a dragged one back to the layout', async () => {
        showDiagram();
        const { registry } = fakes();
        expect(completed(await registry.execute('diagram.read', { viewId: diagramId }, VOICE_ACTION_CALL)).output).toMatchObject({
            title: 'Wire',
            nodes: [
                { id: 'client', label: 'Client', pinned: true },
                { id: 'server', label: 'Server', pinned: false }
            ],
            edges: [{ from: 'client', to: 'server', label: 'http' }]
        });
        const renamed = completed(
            await registry.execute('diagram.updateNode', { viewId: diagramId, diagramNodeId: 'server', label: ' API ', tone: 'blue' }, VOICE_ACTION_CALL)
        );
        expect(diagram().content.nodes[1]).toMatchObject({ label: 'API', tone: 'blue' });
        expect(diagram().past).toHaveLength(1);
        await registry.undo(renamed.undoToken!, VOICE_ACTION_CALL);
        expect(diagram().content.nodes[1]).toEqual({ id: 'server', label: 'Server' });
        completed(await registry.execute('diagram.resetPosition', { viewId: diagramId, diagramNodeId: 'client' }, PERSON_ACTION_CALL));
        expect(diagram().content.nodes[0]).not.toHaveProperty('pos');
        expect(
            completed(await registry.execute('diagram.resetPosition', { viewId: diagramId, diagramNodeId: 'client' }, PERSON_ACTION_CALL)).output.changed
        ).toBe(false);
        expect(
            await registry.execute('diagram.updateNode', { viewId: diagramId, diagramNodeId: 'nope', label: 'X', tone: null }, VOICE_ACTION_CALL)
        ).toMatchObject({
            error: { code: 'unknown-diagram-node' }
        });
    });

    test('replacing a diagram asks Voice first, refuses a broken graph, and a person runs straight through', async () => {
        showDiagram();
        const { registry } = fakes();
        const content = { meta: { title: 'New', direction: 'down' }, nodes: [{ id: 'x', label: 'X' }], groups: [], edges: [] };
        const asked = await registry.execute('diagram.replaceContent', { viewId: diagramId, document: JSON.stringify(content) }, VOICE_ACTION_CALL);
        expect(asked).toMatchObject({ status: 'needs_confirmation', confirmation: { title: 'Replace everything in the diagram “Flow”?' } });
        expect(asked.status === 'needs_confirmation' && asked.confirmation.consequences[0]).toContain('2 nodes, 0 groups and 1 edge');
        const broken = { ...content, edges: [{ from: 'x', to: 'missing' }] };
        expect(await registry.execute('diagram.replaceContent', { viewId: diagramId, document: JSON.stringify(broken) }, PERSON_ACTION_CALL)).toMatchObject({
            error: { code: 'bad-document' }
        });
        const replaced = completed(
            await registry.execute('diagram.replaceContent', { viewId: diagramId, document: JSON.stringify(content) }, PERSON_ACTION_CALL)
        );
        expect(replaced.output).toMatchObject({ nodes: 1, edges: 0 });
        expect(diagram().content.meta.title).toBe('New');
        await registry.undo(replaced.undoToken!, PERSON_ACTION_CALL);
        expect(diagram().content.meta.title).toBe('Wire');
    });

    test('its JSON and its pictures go to the clipboard; a file is saved only by a person', async () => {
        showDiagram();
        const { log, registry } = fakes();
        completed(await registry.execute('diagram.copy', { viewId: diagramId, format: 'json' }, VOICE_ACTION_CALL));
        completed(await registry.execute('diagram.copy', { viewId: diagramId, format: 'png' }, VOICE_ACTION_CALL));
        completed(await registry.execute('diagram.export', { viewId: diagramId, format: 'png' }, PERSON_ACTION_CALL));
        expect(await registry.execute('diagram.export', { viewId: diagramId, format: 'png' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(log).toEqual([expect.stringContaining('"title": "Wire"'), 'png', 'save:diagram-DAY.png:image/png']);
    });
});
