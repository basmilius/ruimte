import { describe, expect, test } from 'bun:test';
import { DrawingDocumentSchema, type DrawingElement } from './drawing-host.ts';
import { REQUEST_SCHEMAS } from './index.ts';
import { duplicateIdIn } from './project-migrate.ts';
import { ProjectDocumentSchema } from './project.ts';

const rect: DrawingElement = { kind: 'rect', id: 'el-1', x: 0, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 7 };

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

    test('a separate drawing document keeps element ids that also name project views', () => {
        const parsed = ProjectDocumentSchema.parse(document);
        const drawing = DrawingDocumentSchema.parse({
            version: 1,
            rev: 1,
            elements: [
                { ...rect, id: 'main' },
                { ...rect, id: 'view-abc' }
            ]
        });
        expect(drawing.elements.map((element) => element.id)).toEqual(['main', 'view-abc']);
        expect(duplicateIdIn(parsed.views)).toBeNull();
        expect(duplicateIdIn([...parsed.views, { kind: 'drawing', id: 'main', name: 'Duplicate' }])).toBe('main');
    });
});

describe('the wire', () => {
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
