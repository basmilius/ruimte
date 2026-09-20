import { describe, expect, test } from 'bun:test';
import {
    edgeRole,
    isOpenableView,
    isUnknownNode,
    isUnknownView,
    PROJECT_VERSION,
    ProjectDocumentSchema,
    storedViewsOf,
    type ProjectCanvasView
} from './project.ts';
import { duplicateIdIn, migrateSharedFile, withoutCrossViewEdges } from './project-migrate.ts';

const migratedFile = (value: unknown) => migrateSharedFile(value)?.file ?? null;
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
            edges: [{ id: 'edge-1', from: 'holo', to: 'term', label: 'context', relation: 'origin' }],
            layouts: []
        },
        { name: 'Flow', kind: 'timeline', id: 'timeline-1', createdBy: 'term', tracks: [{ at: 0 }], zoom: 'wide' },
        { kind: 'drawing', id: 'sketch', name: 'Sketch' }
    ]
};

const parsedFrom = (file: unknown) => {
    const document = migratedFile(structuredClone(file));
    if (!document) {
        throw new Error('the newer file was refused');
    }
    return document;
};

const parsed = () => parsedFrom(NEWER_FILE);

const canvasOf = (views: readonly unknown[]): ProjectCanvasView => views[0] as ProjectCanvasView;

/* The entries a newer Ruimte owns, as text: a known entry is rewritten in the order of its schema, as it always was. */
const unknownEntriesOf = (views: readonly unknown[]): string => JSON.stringify([canvasOf(views).nodes[1], views[1]]);

const UNKNOWN_ENTRIES = JSON.stringify([NEWER_FILE.views[0]!.nodes![1], NEWER_FILE.views[1]]);

describe('kinds this version does not know', () => {
    test('a diagram node is a kind this version knows, not one it only carries', () => {
        const file = structuredClone(NEWER_FILE);
        file.views[0]!.nodes!.push({ id: 'flow', kind: 'diagram', title: 'Flow', x: 0, y: 400, w: 480, h: 360, viewId: 'flow-1' } as never);
        const node = canvasOf(migratedFile(file)!.views).nodes[2]!;
        expect(isUnknownNode(node)).toBe(false);
        expect(node).toMatchObject({ kind: 'diagram', viewId: 'flow-1' });
    });

    test('a device node and view are known only with a portable reference', () => {
        const reference = { platform: 'ios', kind: 'simulator', name: 'iPhone 18 Pro', runtime: 'iOS 27.0' };
        const file = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        const main = file.views[0] as { nodes: unknown[] };
        main.nodes.push({ id: 'phone-node', kind: 'device', title: 'Phone', x: 0, y: 400, w: 360, h: 720, device: reference });
        file.views.push({ id: 'phone-view', kind: 'device', name: 'Phone', device: reference });

        const document = migratedFile(file)!;
        expect(isUnknownNode(canvasOf(document.views).nodes.at(-1)!)).toBe(false);
        expect(isUnknownView(document.views.at(-1)!)).toBe(false);

        const missing = structuredClone(file);
        delete (missing.views.at(-1) as Record<string, unknown>).device;
        expect(migratedFile(missing)).toBeNull();
    });

    test('a view and a node of an unknown kind are read and written back byte for byte', () => {
        const document = parsed();
        expect(isUnknownView(document.views[1]!)).toBe(true);
        expect(isUnknownNode(canvasOf(document.views).nodes[1]!)).toBe(true);
        expect(unknownEntriesOf(storedViewsOf(document.views))).toBe(UNKNOWN_ENTRIES);
    });

    test('the wire carries the in-memory shape, and reading it again gives the same document and the same file', () => {
        const document = parsed();
        const again = ProjectDocumentSchema.parse(JSON.parse(JSON.stringify({ ...document, rev: 0 })));
        expect(again.views).toEqual(document.views);
        expect(unknownEntriesOf(storedViewsOf(again.views))).toBe(UNKNOWN_ENTRIES);
    });

    test('an unknown view is listed under its name and who made it, and nothing opens, renames or copies it', () => {
        const document = parsed();
        const view = document.views[1]!;
        expect(view).toMatchObject({ kind: 'unknown', id: 'timeline-1', name: 'Flow', createdBy: 'term' });
        expect(isOpenableView(view)).toBe(false);
        expect(withRenamedView(document.views, 'timeline-1', 'Other')).toBeNull();
        expect(withViewIcon(document.views, 'timeline-1', { kind: 'lucide', value: 'rocket' })).toBeNull();
        expect(withDuplicatedView(document.views, 'timeline-1', (prefix) => `${prefix}-copy`)).toBeNull();
    });

    test('an unknown view without a name is called after its kind, and still written without one', () => {
        const file = { ...NEWER_FILE, views: [NEWER_FILE.views[0], { kind: 'timeline', id: 'bare' }] };
        const document = migratedFile(structuredClone(file))!;
        expect(document.views[1]).toMatchObject({ kind: 'unknown', name: 'timeline' });
        expect(JSON.stringify(storedViewsOf(document.views)[1])).toBe(JSON.stringify(file.views[1]));
    });

    test('a node of an unknown kind that a person moved keeps every field it had and takes the new place', () => {
        const document = parsed();
        const canvas = canvasOf(document.views);
        const moved = {
            ...document,
            views: [{ ...canvas, nodes: canvas.nodes.map((node) => (node.id === 'holo' ? { ...node, x: 10, h: 400 } : node)) }, ...document.views.slice(1)]
        };
        const stored = canvasOf(storedViewsOf(moved.views)).nodes[1];
        expect(stored).toEqual({ ...NEWER_FILE.views[0]!.nodes![1]!, x: 10, h: 400 } as never);
        expect(Object.keys(stored!)).toEqual(Object.keys(NEWER_FILE.views[0]!.nodes![1]!));
    });

    test('a copy of a canvas gives an unknown node its new id in the file too', () => {
        const document = parsed();
        const copy = withDuplicatedView(document.views, 'main', (prefix) => `${prefix}-copy`)!;
        const stored = storedViewsOf(copy.views);
        const nodes = canvasOf([stored[1]]).nodes as unknown as { id: string }[];
        expect(nodes.map((node) => node.id)).toEqual(['terminal-copy', 'unknown-copy']);
        expect(duplicateIdIn(ProjectDocumentSchema.parse({ ...document, views: stored, version: PROJECT_VERSION, rev: 5 }).views)).toBeNull();
    });

    test('a field a newer Ruimte put on an edge is read, sent and written back with it', () => {
        const document = parsed();
        expect(canvasOf(document.views).edges[0]!.relation).toBe('origin');
        expect(JSON.stringify(canvasOf(storedViewsOf(document.views)).edges)).toBe(JSON.stringify(NEWER_FILE.views[0]!.edges));

        // The wire is parsed on both ends, so a field that only survives one of the two is still lost.
        const again = ProjectDocumentSchema.parse(JSON.parse(JSON.stringify({ ...document, rev: 0 })));
        expect(JSON.stringify(canvasOf(storedViewsOf(again.views)).edges)).toBe(JSON.stringify(NEWER_FILE.views[0]!.edges));
    });

    test('a role this version does not know keeps its line, and reads as no role', () => {
        const file = structuredClone(NEWER_FILE) as { views: { edges: Record<string, unknown>[] }[] };
        file.views[0]!.edges[0]!.role = 'beams';
        const edges = canvasOf(parsedFrom(file).views).edges;

        // The whole edge would be gone had the word been checked against an enum, line and label with it.
        expect(edges).toHaveLength(1);
        expect(edges[0]!.role).toBe('beams');
        expect(edgeRole(edges[0]!)).toBeNull();
        // A known key is rewritten in the order of the schema, so only the fields themselves may be compared.
        expect(canvasOf(storedViewsOf(parsedFrom(file).views)).edges).toEqual(file.views[0]!.edges as never);
    });

    test('a role this version knows is read off the line', () => {
        const file = structuredClone(NEWER_FILE) as { views: { edges: Record<string, unknown>[] }[] };
        file.views[0]!.edges[0]!.role = 'target';
        expect(edgeRole(canvasOf(parsedFrom(file).views).edges[0]!)).toBe('target');
    });

    test('an unknown node counts for its edges and its id', () => {
        const document = parsed();
        expect(canvasOf(withoutCrossViewEdges(document.views)).edges).toHaveLength(1);
        const clash = structuredClone(NEWER_FILE);
        clash.views[0]!.nodes![0]!.id = 'holo';
        expect(duplicateIdIn(migratedFile(clash)!.views)).toBe('holo');
    });

    test('a kind this version knows is still checked, field by field', () => {
        const badView = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        badView.views[2] = { kind: 'browser', id: 'web', name: 'Web' };
        expect(migratedFile(badView)).toBeNull();

        const badNode = structuredClone(NEWER_FILE);
        badNode.views[0]!.nodes![0]!.w = -1;
        expect(migratedFile(badNode)).toBeNull();
    });

    test('an entry without an id or a kind is still no document', () => {
        const noId = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        noId.views[1] = { kind: 'timeline', name: 'Flow' };
        expect(migratedFile(noId)).toBeNull();

        const noKind = structuredClone(NEWER_FILE) as { views: Record<string, unknown>[] };
        noKind.views[1] = { id: 'timeline-1', name: 'Flow' };
        expect(migratedFile(noKind)).toBeNull();
    });
});
