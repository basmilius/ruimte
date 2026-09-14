import { describe, expect, test } from 'bun:test';
import { isOpenableView, isUnknownNode, isUnknownView, ProjectDocumentSchema, storedContentOf, type ProjectCanvasView } from './project.ts';
import { duplicateIdIn, migrateDocument, withoutCrossViewEdges } from './project-migrate.ts';
import { withDuplicatedView, withRenamedView, withViewIcon } from './project-views.ts';

/* A file as a newer Ruimte writes it: a view and a canvas node of kinds this version never heard of. */
const NEWER_FILE = {
    version: 2,
    rev: 4,
    name: 'repo',
    color: '#7c74ff',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'term', kind: 'terminal', title: 'Terminal', x: 0, y: 0, w: 560, h: 360 },
                { kind: 'hologram', id: 'holo', title: 'Hologram', x: 600, y: 40, w: 480, h: 360, beam: { color: 'teal', lumens: [1, 2] }, path: 42 }
            ],
            texts: [],
            edges: [{ id: 'edge-1', from: 'holo', to: 'term', label: 'context' }],
            layouts: []
        },
        { name: 'Flow', kind: 'timeline', id: 'timeline-1', createdBy: 'term', tracks: [{ at: 0 }], zoom: 'wide' },
        { kind: 'drawing', id: 'sketch', name: 'Sketch' }
    ]
};

const parsed = () => {
    const document = migrateDocument(structuredClone(NEWER_FILE));
    if (!document) {
        throw new Error('the newer file was refused');
    }
    return document;
};

const canvasOf = (views: readonly unknown[]): ProjectCanvasView => views[0] as ProjectCanvasView;

/* The entries a newer Ruimte owns, as text: a known entry is rewritten in the order of its schema, as it always was. */
const unknownEntriesOf = (views: readonly unknown[]): string => JSON.stringify([canvasOf(views).nodes[1], views[1]]);

const UNKNOWN_ENTRIES = JSON.stringify([NEWER_FILE.views[0]!.nodes![1], NEWER_FILE.views[1]]);

describe('kinds this version does not know', () => {
    test('a view and a node of an unknown kind are read and written back byte for byte', () => {
        const document = parsed();
        expect(isUnknownView(document.views[1]!)).toBe(true);
        expect(isUnknownNode(canvasOf(document.views).nodes[1]!)).toBe(true);
        expect(unknownEntriesOf(storedContentOf(document).views)).toBe(UNKNOWN_ENTRIES);
    });

    test('the wire carries the in-memory shape, and reading it again gives the same document and the same file', () => {
        const document = parsed();
        const again = ProjectDocumentSchema.parse(JSON.parse(JSON.stringify(document)));
        expect(again).toEqual(document);
        expect(unknownEntriesOf(storedContentOf(again).views)).toBe(UNKNOWN_ENTRIES);
    });

    test('an unknown view is listed under its name and who made it, and nothing opens, renames or copies it', () => {
        const document = parsed();
        const view = document.views[1]!;
        expect(view).toMatchObject({ kind: 'unknown', id: 'timeline-1', name: 'Flow', createdBy: 'term' });
        expect(isOpenableView(view)).toBe(false);
        expect(withRenamedView(document.views, 'timeline-1', 'Other')).toBeNull();
        expect(withViewIcon(document.views, 'timeline-1', { kind: 'emoji', value: 'x' })).toBeNull();
        expect(withDuplicatedView(document.views, 'timeline-1', (prefix) => `${prefix}-copy`)).toBeNull();
    });

    test('an unknown view without a name is called after its kind, and still written without one', () => {
        const file = { ...NEWER_FILE, views: [NEWER_FILE.views[0], { kind: 'timeline', id: 'bare' }] };
        const document = migrateDocument(structuredClone(file))!;
        expect(document.views[1]).toMatchObject({ kind: 'unknown', name: 'timeline' });
        expect(JSON.stringify(storedContentOf(document).views[1])).toBe(JSON.stringify(file.views[1]));
    });

    test('a node of an unknown kind that a person moved keeps every field it had and takes the new place', () => {
        const document = parsed();
        const canvas = canvasOf(document.views);
        const moved = {
            ...document,
            views: [{ ...canvas, nodes: canvas.nodes.map((node) => (node.id === 'holo' ? { ...node, x: 10, h: 400 } : node)) }, ...document.views.slice(1)]
        };
        const stored = canvasOf(storedContentOf(moved).views).nodes[1];
        expect(stored).toEqual({ ...NEWER_FILE.views[0]!.nodes![1]!, x: 10, h: 400 } as never);
        expect(Object.keys(stored!)).toEqual(Object.keys(NEWER_FILE.views[0]!.nodes![1]!));
    });

    test('a copy of a canvas gives an unknown node its new id in the file too', () => {
        const document = parsed();
        const copy = withDuplicatedView(document.views, 'main', (prefix) => `${prefix}-copy`)!;
        const stored = storedContentOf({ ...document, views: copy.views });
        const nodes = canvasOf([stored.views[1]]).nodes as unknown as { id: string }[];
        expect(nodes.map((node) => node.id)).toEqual(['terminal-copy', 'unknown-copy']);
        expect(duplicateIdIn(ProjectDocumentSchema.parse({ ...stored, version: 2, rev: 5 }).views)).toBeNull();
    });

    test('an unknown node counts for its edges and its id', () => {
        const document = parsed();
        expect(canvasOf(withoutCrossViewEdges(document.views)).edges).toHaveLength(1);
        const clash = structuredClone(NEWER_FILE);
        clash.views[0]!.nodes![0]!.id = 'holo';
        expect(duplicateIdIn(migrateDocument(clash)!.views)).toBe('holo');
    });

    test('a kind this version knows is still checked, field by field', () => {
        const badView = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        badView.views[2] = { kind: 'browser', id: 'web', name: 'Web' };
        expect(migrateDocument(badView)).toBeNull();

        const badNode = structuredClone(NEWER_FILE);
        badNode.views[0]!.nodes![0]!.w = -1;
        expect(migrateDocument(badNode)).toBeNull();
    });

    test('an entry without an id or a kind is still no document', () => {
        const noId = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        noId.views[1] = { kind: 'timeline', name: 'Flow' };
        expect(migrateDocument(noId)).toBeNull();

        const noKind = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        noKind.views[1] = { id: 'timeline-1', name: 'Flow' };
        expect(migrateDocument(noKind)).toBeNull();
    });
});
