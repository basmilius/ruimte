import { describe, expect, test } from 'bun:test';
import { ProjectDocumentSchema, ProjectLocalSchema, ProjectSaveLocalPayloadSchema, type ProjectCanvasView } from './project.ts';
import { duplicateIdIn, migrateDocument, migrateLocal, withoutCrossViewEdges } from './project-migrate.ts';

/* A copy of `.ruimte/project.json` of this repository, the way version 1 wrote it. */
const V1_FILE = {
    version: 1,
    rev: 11,
    name: 'ruimte',
    color: '#7c74ff',
    nodes: [
        { id: 'browser-8x6vy84f', kind: 'browser', title: 'Browser', x: -568, y: -88, w: 720, h: 480 },
        { id: 'terminal-gepojlyc', kind: 'terminal', title: 'Terminal', x: -584, y: -592, w: 560, h: 360 },
        { id: 'chat-heglurhw', kind: 'chat', title: 'Claude Code', x: -1560, y: -600, w: 896, h: 808, provider: 'claude', providerFixed: true }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const canvasOf = (view: ProjectCanvasView | undefined): ProjectCanvasView => {
    if (!view || view.kind !== 'canvas') {
        throw new Error('the migrated view is not a canvas');
    }
    return view;
};

describe('migrateDocument', () => {
    test('a version-1 file becomes exactly one canvas view called main', () => {
        const migrated = migrateDocument(V1_FILE);
        expect(migrated).not.toBeNull();
        expect(migrated).toMatchObject({ version: 2, rev: 11, name: 'ruimte', color: '#7c74ff' });
        expect(migrated!.views).toHaveLength(1);
        const canvas = canvasOf(migrated!.views[0] as ProjectCanvasView);
        expect(canvas).toMatchObject({ kind: 'canvas', id: 'main', name: 'Canvas' });
        expect(canvas.nodes.map((node) => node.id)).toEqual(['browser-8x6vy84f', 'terminal-gepojlyc', 'chat-heglurhw']);
        expect(canvas.layouts).toEqual([]);
    });

    test('what the migration produces is what version 2 parses, and reading it again changes nothing', () => {
        const once = migrateDocument(V1_FILE)!;
        expect(ProjectDocumentSchema.safeParse(once).success).toBe(true);
        const twice = migrateDocument(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
    });

    test('a file from before layouts existed migrates on the default', () => {
        const { layouts: _layouts, ...withoutLayouts } = V1_FILE;
        expect(canvasOf(migrateDocument(withoutLayouts)!.views[0] as ProjectCanvasView).layouts).toEqual([]);
    });

    test('an icon rides along and anything else is refused', () => {
        const migrated = migrateDocument({ ...V1_FILE, icon: { kind: 'lucide', value: 'rocket' } });
        expect(migrated!.icon).toEqual({ kind: 'lucide', value: 'rocket' });
        expect(migrateDocument({ version: 3, rev: 0 })).toBeNull();
        expect(migrateDocument({ ...V1_FILE, nodes: [{ id: 'n1', kind: 'note' }] })).toBeNull();
        expect(migrateDocument('nonsense')).toBeNull();
    });
});

describe('migrateLocal', () => {
    test('the focus of version 1 lands under the view it belonged to, and its screen-offset camera as none', () => {
        const panels = { panel: { open: true, kind: 'git' as const } };
        const migrated = migrateLocal({ camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: 'n1', panels });
        expect(migrated).toEqual({
            activeViewId: 'main',
            views: { main: { camera: null, focusedNodeId: 'n1' } },
            panels
        });
        expect(ProjectLocalSchema.safeParse(migrated).success).toBe(true);
    });

    test('a version-2 file passes through and a file that is gone or broken starts from nothing', () => {
        const local = { activeViewId: 'backend', views: { backend: { camera: null, focusedNodeId: null } } };
        expect(migrateLocal(local)).toEqual(local);
        expect(migrateLocal(undefined)).toEqual({ activeViewId: null, views: {} });
        expect(migrateLocal({ camera: 'nope' })).toEqual({ activeViewId: null, views: {} });
    });

    test('a camera is the middle of the cell and the zoom, and one in the old screen-offset shape reads as none', () => {
        const centered = { activeViewId: 'a', views: { a: { camera: { center: { x: 420, y: -180 }, zoom: 0.75 }, focusedNodeId: null } } };
        expect(migrateLocal(centered)).toEqual(centered);
        const old = {
            activeViewId: 'a',
            views: { a: { camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: 'n1' } },
            panels: { panel: { open: true, kind: 'git' as const } }
        };
        expect(migrateLocal(old)).toEqual({ ...old, views: { a: { camera: null, focusedNodeId: 'n1' } } });
        expect(migrateLocal({ activeViewId: 'a', views: { a: { camera: { center: { x: 1 }, zoom: 1 }, focusedNodeId: null } } })).toEqual({
            activeViewId: null,
            views: {}
        });
    });

    test('a save-local from an older client with the old camera is taken, the camera dropped', () => {
        const parsed = ProjectSaveLocalPayloadSchema.safeParse({
            projectId: 'p1',
            local: { activeViewId: 'a', views: { a: { camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: null } } }
        });
        expect(parsed.success).toBe(true);
        expect(parsed.data?.local.views.a).toEqual({ camera: null, focusedNodeId: null });
    });

    test('a split layout rides along, and a file without one is the one cell it always was', () => {
        const layout = {
            columns: [
                { size: 0.5, cells: [{ viewId: 'backend', size: 1 }] },
                { size: 0.5, cells: [{ viewId: 'notes', size: 1 }] }
            ],
            focus: { column: 1, cell: 0 }
        };
        const local = { activeViewId: 'notes', views: {}, layout };
        expect(migrateLocal(local)).toEqual(local);
        expect(migrateLocal({ activeViewId: 'notes', views: {} }).layout).toBeUndefined();
    });

    test('a layout that is not a layout loses the whole local file rather than half of it', () => {
        expect(migrateLocal({ activeViewId: 'a', views: {}, layout: { columns: [] } })).toEqual({ activeViewId: null, views: {} });
    });
});

describe('the invariants over a project', () => {
    const canvas = (id: string, nodeIds: string[]): ProjectCanvasView => ({
        kind: 'canvas',
        id,
        name: id,
        nodes: nodeIds.map((nodeId) => ({ id: nodeId, kind: 'terminal' as const, title: nodeId, x: 0, y: 0, w: 10, h: 10 })),
        texts: [],
        edges: [],
        layouts: []
    });

    test('a node id that repeats in another view is named', () => {
        expect(duplicateIdIn([canvas('a', ['n1']), canvas('b', ['n2'])])).toBeNull();
        expect(duplicateIdIn([canvas('a', ['n1']), canvas('b', ['n1'])])).toBe('n1');
        expect(duplicateIdIn([canvas('a', []), canvas('a', [])])).toBe('a');
        // A view and a node share one namespace: both are keys of the daemon's session map.
        expect(duplicateIdIn([canvas('a', ['b']), canvas('b', [])])).toBe('b');
    });

    test('an edge that points outside its own view is dropped, and the rest of the view is untouched', () => {
        const views: ProjectCanvasView[] = [
            {
                ...canvas('a', ['n1', 'n2']),
                edges: [
                    { id: 'e1', from: 'n1', to: 'n2' },
                    { id: 'e2', from: 'n1', to: 'far' }
                ]
            },
            canvas('b', ['far'])
        ];
        const cleaned = withoutCrossViewEdges(views);
        expect((cleaned[0] as ProjectCanvasView).edges.map((edge) => edge.id)).toEqual(['e1']);
        expect((cleaned[0] as ProjectCanvasView).nodes).toHaveLength(2);
        // Nothing to drop means the very same view, so a read never looks like an edit.
        expect(withoutCrossViewEdges(cleaned)[0]).toBe(cleaned[0]);
    });
});
