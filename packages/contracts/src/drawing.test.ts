import { describe, expect, test } from 'bun:test';
import { DrawingDocumentSchema, EMPTY_DRAWING, duplicateElementIdIn, migrateDrawing, type DrawingElement } from './drawing.ts';
import { ProjectDocumentSchema } from './project.ts';
import { duplicateIdIn } from './project-migrate.ts';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';

const rect: DrawingElement = { kind: 'rect', id: 'el-1', x: 0, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 7 };

const text: DrawingElement = { kind: 'text', id: 'el-2', x: 20, y: 20, w: 80, h: 24, stroke: 'blue', strokeWidth: 1, seed: 3, text: 'hello', size: 20 };

const stroke: DrawingElement = {
    kind: 'freehand',
    id: 'el-3',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    stroke: 'red',
    strokeWidth: 4,
    seed: 1,
    points: [
        [0, 0, 0.5],
        [10, 10]
    ]
};

describe('the drawing document', () => {
    test('a document with every element kind round-trips', () => {
        const document = {
            version: 1,
            rev: 4,
            elements: [
                rect,
                { kind: 'diamond', id: 'el-4', x: 0, y: 0, w: 40, h: 40, stroke: 'ink', strokeWidth: 1, seed: 2 },
                { kind: 'ellipse', id: 'el-5', x: 0, y: 0, w: 40, h: 40, stroke: 'ink', strokeWidth: 1, seed: 2, fill: 'hachure', fillColor: 'yellow' },
                {
                    kind: 'line',
                    id: 'el-6',
                    x: 0,
                    y: 0,
                    w: 100,
                    h: 0,
                    stroke: 'ink',
                    strokeWidth: 2,
                    strokeStyle: 'dashed',
                    seed: 9,
                    points: [
                        [0, 0],
                        [100, 0]
                    ],
                    arrowEnd: true
                },
                stroke,
                text
            ]
        };
        const parsed = migrateDrawing(JSON.parse(JSON.stringify(document)));
        expect(parsed).not.toBeNull();
        expect(parsed).toEqual(DrawingDocumentSchema.parse(document));
    });

    test('EMPTY_DRAWING parses as a document', () => {
        expect(migrateDrawing(EMPTY_DRAWING)).toEqual(EMPTY_DRAWING);
    });

    test('an absent roughness and font stay absent, so the reader decides what they mean', () => {
        const parsed = migrateDrawing({ version: 1, rev: 0, elements: [rect, text] })!;
        expect(parsed.elements[0]).not.toHaveProperty('roughness');
        expect(parsed.elements[1]).not.toHaveProperty('font');
    });

    test('an unknown element kind, a stray roughness and a stray stroke width are refused', () => {
        expect(migrateDrawing({ version: 1, rev: 0, elements: [{ ...rect, kind: 'star' }] })).toBeNull();
        expect(migrateDrawing({ version: 1, rev: 0, elements: [{ ...rect, roughness: 3 }] })).toBeNull();
        expect(migrateDrawing({ version: 1, rev: 0, elements: [{ ...rect, strokeWidth: 3 }] })).toBeNull();
        expect(migrateDrawing({ version: 1, rev: 0, elements: [{ ...rect, stroke: '#ff0000' }] })).toBeNull();
    });

    test('a version other than 1 and a missing rev are refused', () => {
        expect(migrateDrawing({ version: 2, rev: 0, elements: [] })).toBeNull();
        expect(migrateDrawing({ version: 1, elements: [] })).toBeNull();
    });

    test('a repeated element id is named', () => {
        expect(duplicateElementIdIn([rect, text])).toBeNull();
        expect(duplicateElementIdIn([rect, { ...text, id: rect.id }])).toBe('el-1');
    });
});

describe('a drawing view in a project document', () => {
    const document = {
        version: 3,
        rev: 1,
        name: 'ruimte',
        color: '#7c74ff',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'drawing', id: 'view-abc', name: 'Drawing' }
        ]
    };

    test('it parses and carries nothing but its id and name', () => {
        const parsed = ProjectDocumentSchema.parse(document);
        expect(parsed.views[1]).toEqual({ kind: 'drawing', id: 'view-abc', name: 'Drawing' });
    });

    test('element ids stay out of the project namespace, so only view and node ids collide', () => {
        const parsed = ProjectDocumentSchema.parse(document);
        expect(duplicateIdIn(parsed.views)).toBeNull();
    });
});

describe('the wire', () => {
    test('every drawing request and event is in the tables', () => {
        expect(Object.keys(REQUEST_SCHEMAS)).toEqual(expect.arrayContaining(['drawing.open', 'drawing.save', 'drawing.close', 'drawing.copy']));
        expect(Object.keys(EVENT_SCHEMAS)).toContain('drawing.changed');
    });

    test('a save names the rev it was built on', () => {
        const payload = REQUEST_SCHEMAS['drawing.save'].payload.parse({
            projectId: 'p1',
            viewId: 'view-abc',
            baseRev: 3,
            content: { elements: [rect] }
        });
        expect(payload).toMatchObject({ baseRev: 3 });
        expect(REQUEST_SCHEMAS['drawing.save'].payload.safeParse({ projectId: 'p1', viewId: 'view-abc', content: { elements: [] } }).success).toBe(false);
    });
});
