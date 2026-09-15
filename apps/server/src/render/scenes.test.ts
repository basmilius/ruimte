import { describe, expect, test } from 'bun:test';
import { EMPTY_DIAGRAM, EMPTY_DRAWING, RenderSceneResultSchema, type DiagramDocument, type DrawingDocument, type DrawingElement } from '@ruimte/contracts';
import { layoutOf, shapePaths, textLinesOf } from '@ruimte/diagram';
import { pathsOfElement } from '@ruimte/drawing';
import { renderDiagram, renderDrawing } from './scenes.ts';

const base = { x: 40, y: 60, w: 160, h: 80, stroke: 'blue' as const, strokeWidth: 2 as const, seed: 28 };
const drawing = (elements: DrawingElement[]): DrawingDocument => ({ version: 1, rev: 9, elements });

describe('native render scenes', () => {
    test('empty files render to finite empty scenes', () => {
        for (const scene of [renderDrawing(EMPTY_DRAWING), renderDiagram(EMPTY_DIAGRAM)]) {
            expect(RenderSceneResultSchema.parse(scene)).toEqual({ rev: 0, bounds: { x: 0, y: 0, w: 0, h: 0 }, elements: [] });
        }
    });

    test('diagram shapes and label positions come from the shared layout', () => {
        const document: DiagramDocument = {
            version: 1,
            rev: 4,
            meta: { title: 'Flow', direction: 'right' },
            nodes: [
                { id: 'a', label: 'Database', shape: 'cylinder', tone: 'blue', sub: 'Store' },
                { id: 'b', label: 'Client', shape: 'pill' }
            ],
            groups: [{ id: 'group', label: 'System', wraps: ['a', 'b'], tone: 'purple' }],
            edges: [{ from: 'a', to: 'b', label: 'Reads', style: 'dashed', tone: 'orange' }]
        };
        const scene = RenderSceneResultSchema.parse(renderDiagram(document));
        const layout = layoutOf(document);
        expect(scene.rev).toBe(4);
        expect(scene.bounds).toEqual(layout.bounds);
        expect(scene.elements.map((element) => element.id)).toEqual(['group:group', 'edge:0', 'node:a', 'node:b']);
        const database = scene.elements[2]!;
        const shape = shapePaths('cylinder', layout.nodes[0]!);
        expect(database.paths.map((path) => path.d)).toEqual([shape.body, shape.detail!]);
        expect(database.paths[0]?.fill).toEqual({ tone: 'blue', palette: 'paper' });
        expect(database.paths[1]?.fill).toBeNull();
        expect(database.text.map(({ text, x, y }) => ({ text, x, y }))).toEqual(
            textLinesOf(layout.nodes[0]!, 'cylinder').map(({ text, x, y }) => ({ text, x, y }))
        );
        expect(database.text[1]?.color).toEqual({ tone: 'muted', palette: 'ink' });
        expect(scene.elements[1]?.paths[0]?.dash).toEqual([8, 6]);
        expect(JSON.stringify(scene)).not.toContain('#');
    });

    test('rough paths keep their exact seeds and hachures remain strokes', () => {
        const element: DrawingElement = { ...base, id: 'rough', kind: 'ellipse', fill: 'hachure', fillColor: 'green' };
        const scene = renderDrawing(drawing([element]));
        expect(RenderSceneResultSchema.safeParse(scene).success).toBe(true);
        expect(scene.elements[0]?.paths.map((path) => path.d)).toEqual(pathsOfElement(element).map((path) => path.d));
        expect(renderDrawing(drawing([element]))).toEqual(scene);
        expect(scene.elements[0]?.paths.some((path) => path.stroke?.tone === 'green' && path.fill === null)).toBe(true);
    });

    test('notes carry their paper, edge, wrapped text and local rotation center', () => {
        const scene = renderDrawing(
            drawing([
                {
                    ...base,
                    id: 'note',
                    kind: 'note',
                    text: 'A sticky note with several words',
                    size: 20,
                    fillColor: 'yellow',
                    angle: Math.PI / 2,
                    align: 'center'
                }
            ])
        );
        const note = scene.elements[0]!;
        expect(note).toMatchObject({ x: 40, y: 60, centerX: 80, centerY: 40, angle: Math.PI / 2 });
        expect(note.paths.some((path) => path.fill?.palette === 'paper' && path.fill.tone === 'yellow')).toBe(true);
        expect(note.paths.some((path) => path.stroke?.palette === 'edge' && path.stroke.tone === 'yellow')).toBe(true);
        expect(note.text.length).toBeGreaterThan(1);
        expect(note.text[0]).toMatchObject({ x: 80, y: 36, align: 'center', font: 'hand', color: { tone: 'blue', palette: 'ink' } });
        expect(scene.bounds.x).toBeCloseTo(80);
        expect(scene.bounds.y).toBeCloseTo(20);
        expect(scene.bounds.w).toBeCloseTo(80);
        expect(scene.bounds.h).toBeCloseTo(160);
    });

    test('freehand ink is filled and text elements contain no shape', () => {
        const scene = renderDrawing(
            drawing([
                {
                    ...base,
                    id: 'pen',
                    kind: 'freehand',
                    points: [
                        [0, 0, 0.2],
                        [20, 15, 0.8],
                        [50, 0, 0.5]
                    ]
                },
                { ...base, id: 'text', kind: 'text', text: '<hello>\nworld', size: 24, font: 'mono', align: 'right' }
            ])
        );
        expect(scene.elements[0]?.paths[0]).toMatchObject({ stroke: null, fill: { tone: 'blue', palette: 'ink' } });
        expect(scene.elements[1]?.paths).toEqual([]);
        expect(scene.elements[1]?.text.map((line) => line.text)).toEqual(['<hello>', 'world']);
        expect(scene.elements[1]?.text[0]).toMatchObject({ align: 'right', x: 160, font: 'mono' });
    });
});
