import { describe, expect, test } from 'bun:test';
import { ProjectDocumentSchema, type ProjectCanvasView, type ProjectView } from './project.ts';
import {
    emptyCanvasView,
    idsInViews,
    sessionNodesOfView,
    withDuplicatedView,
    withMovedView,
    withNodeAsView,
    withNodeOnView,
    withRenamedView,
    withView,
    withViewAsNode,
    withViewIcon,
    withoutView
} from './project-views.ts';

const node = (id: string, kind: ProjectCanvasView['nodes'][number]['kind'] = 'terminal'): ProjectCanvasView['nodes'][number] => ({
    id,
    kind,
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 80
});

const canvas = (id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes,
    texts: [],
    edges: [],
    layouts: []
});

// A fresh id per call, so a duplicate is checked on its shape rather than on a counter's state.
const ids = (): ((prefix: string) => string) => {
    let counter = 0;
    return (prefix) => {
        counter += 1;
        return `${prefix}-${counter}`;
    };
};

describe('adding a view', () => {
    test('lands last, or right under the view it names', () => {
        const views = [canvas('a'), canvas('b')];
        expect(withView(views, canvas('c')).map((view) => view.id)).toEqual(['a', 'b', 'c']);
        expect(withView(views, canvas('c'), 'a').map((view) => view.id)).toEqual(['a', 'c', 'b']);
        // An id nobody has is the same as naming nothing: the view still lands.
        expect(withView(views, canvas('c'), 'gone').map((view) => view.id)).toEqual(['a', 'b', 'c']);
    });

    test('every id of the project is in one namespace, nodes and texts included', () => {
        const views: ProjectView[] = [
            { ...canvas('a', [node('n1')]), texts: [{ id: 't1', x: 0, y: 0, text: 'hi', size: 16 }], edges: [{ id: 'e1', from: 'n1', to: 't1' }] },
            { kind: 'separator', id: 'sep' }
        ];
        expect([...idsInViews(views)].sort()).toEqual(['a', 'e1', 'n1', 'sep', 't1']);
    });
});

describe('renaming', () => {
    test('sets the source, so nothing the view hosts renames over it', () => {
        expect(withRenamedView([canvas('a')], 'a', 'Board')![0]).toMatchObject({ name: 'Board', titleSource: 'user' });
    });

    test('a rename that changes nothing is no change at all', () => {
        const views: ProjectView[] = [{ ...canvas('a'), name: 'Board', titleSource: 'user' }];
        expect(withRenamedView(views, 'a', 'Board')).toBeNull();
        expect(withRenamedView(views, 'gone', 'Board')).toBeNull();
        expect(withRenamedView(views, 'a', 'Board', null)).not.toBeNull();
    });

    test('a separator carries a bare label and no source, since nothing it hosts could rename it', () => {
        const views = withRenamedView([{ kind: 'separator', id: 'sep' }], 'sep', 'Scratch')!;
        expect(views[0]).toEqual({ kind: 'separator', id: 'sep', name: 'Scratch' });
    });
});

describe('the mark a view wears', () => {
    test('a picked icon is kept until it is handed back', () => {
        const picked = withViewIcon([canvas('a')], 'a', { kind: 'lucide', value: 'rocket' })!;
        expect(picked[0]).toMatchObject({ icon: { kind: 'lucide', value: 'rocket' } });
        expect((withViewIcon(picked, 'a', null)![0] as ProjectCanvasView).icon).toBeUndefined();
    });

    test('handing back an icon a view never had is no change at all', () => {
        expect(withViewIcon([canvas('a')], 'a', null)).toBeNull();
    });

    test('a separator has no room for one', () => {
        expect(withViewIcon([{ kind: 'separator', id: 'sep' }], 'sep', { kind: 'lucide', value: 'rocket' })).toBeNull();
    });
});

describe('moving in the list', () => {
    test('the index is where the view ends up, clamped to the list', () => {
        const views = [canvas('a'), canvas('b'), canvas('c')];
        expect(withMovedView(views, 'c', 0)!.map((view) => view.id)).toEqual(['c', 'a', 'b']);
        expect(withMovedView(views, 'a', 99)!.map((view) => view.id)).toEqual(['b', 'c', 'a']);
        // Where it already stands, and a view the project does not have, are both no change at all.
        expect(withMovedView(views, 'a', 0)).toBeNull();
        expect(withMovedView(views, 'gone', 0)).toBeNull();
    });
});

describe('duplicating', () => {
    test('a copy lands next to its original with new ids and no session to resume', () => {
        const source: ProjectCanvasView = {
            ...canvas('a', [{ ...node('n1'), resume: 'session-1' }]),
            texts: [{ id: 't1', x: 0, y: 0, text: 'hi', size: 16 }],
            edges: [{ id: 'e1', from: 'n1', to: 't1' }]
        };
        const result = withDuplicatedView([source, canvas('b')], 'a', ids())!;
        expect(result.views.map((view) => view.id)).toEqual(['a', result.id, 'b']);
        const copy = result.views[1] as ProjectCanvasView;
        expect(copy.name).toBe('a copy');
        expect(copy.nodes[0]!.id).not.toBe('n1');
        expect(copy.nodes[0]!.resume).toBeUndefined();
        expect(copy.edges[0]).toMatchObject({ from: copy.nodes[0]!.id, to: copy.texts[0]!.id });
    });

    test('only a canvas, a drawing and a diagram are copied; a view of its own holds a session nobody can clone', () => {
        const views: ProjectView[] = [
            { kind: 'drawing', id: 'd', name: 'Sketch' },
            { kind: 'diagram', id: 'g', name: 'Graph' },
            { kind: 'terminal', id: 'term', name: 'Shell', node: {} }
        ];
        expect(withDuplicatedView(views, 'd', ids())!.views[1]).toMatchObject({ kind: 'drawing', name: 'Sketch copy' });
        expect(withDuplicatedView(views, 'g', ids())!.views[2]).toMatchObject({ kind: 'diagram', name: 'Graph copy' });
        expect(withDuplicatedView(views, 'term', ids())).toBeNull();
    });
});

describe('deleting', () => {
    test('the list loses the view and names the one that left', () => {
        const result = withoutView([canvas('a'), canvas('b')], 'a')!;
        expect(result.views.map((view) => view.id)).toEqual(['b']);
        expect(result.removed.id).toBe('a');
        expect(withoutView([canvas('a')], 'gone')).toBeNull();
    });

    test('taking the last view leaves an empty canvas behind, because a project always has one', () => {
        const result = withoutView([canvas('a')], 'a')!;
        expect(result.views).toHaveLength(1);
        expect(result.views[0]).toMatchObject({ kind: 'canvas', id: 'main', name: 'Canvas', nodes: [] });
    });

    test('separators alone are a list of lines with nowhere to go', () => {
        const result = withoutView([canvas('a'), { kind: 'separator', id: 'sep' }], 'a')!;
        expect(result.views.map((view) => view.kind)).toEqual(['separator', 'canvas']);
    });
});

describe('a node and a view of its own', () => {
    test('a promoted node keeps its id, carries what it was made with and loses its lines', () => {
        const source: ProjectCanvasView = {
            ...canvas('a', [{ ...node('n1'), cwd: '/repo', command: 'bun dev' }, node('n2')]),
            texts: [{ id: 't1', x: 0, y: 0, text: 'hi', size: 16 }],
            edges: [{ id: 'e1', from: 'n1', to: 't1' }]
        };
        const result = withNodeAsView([source, canvas('b')], 'n1')!;
        expect(result.views.map((view) => view.id)).toEqual(['a', 'n1', 'b']);
        expect(result.view).toMatchObject({ kind: 'terminal', name: 'n1', node: { cwd: '/repo', command: 'bun dev' } });
        const left = result.views[0] as ProjectCanvasView;
        expect(left.nodes.map((each) => each.id)).toEqual(['n2']);
        expect(left.edges).toEqual([]);
        expect(left.texts).toHaveLength(1);
    });

    test('only a session leaves the canvas', () => {
        expect(withNodeAsView([canvas('a', [node('g1', 'group')])], 'g1')).toBeNull();
        expect(withNodeAsView([canvas('a')], 'nobody')).toBeNull();
    });

    test('a view put back on a canvas is the same node under the same id', () => {
        const views: ProjectView[] = [canvas('a'), { kind: 'terminal', id: 'term', name: 'Shell', node: { cwd: '/repo' } }];
        const result = withViewAsNode(views, 'term', 'a', { x: 20, y: 30 })!;
        expect(result.views.map((view) => view.id)).toEqual(['a']);
        expect(result.node).toMatchObject({ id: 'term', kind: 'terminal', title: 'Shell', cwd: '/repo', x: 20, y: 30, w: 560, h: 360 });
        expect((result.views[0] as ProjectCanvasView).nodes.map((each) => each.id)).toEqual(['term']);
    });

    test('a simulator moves between canvas and view without storing its local device id', () => {
        const device = { platform: 'ios' as const, kind: 'simulator' as const, name: 'iPhone 18 Pro', runtime: 'iOS 27.0' };
        const source = canvas('a', [{ ...node('phone', 'device'), device }]);
        const promoted = withNodeAsView([source], 'phone')!;

        expect(promoted.view).toEqual({ kind: 'device', id: 'phone', name: 'phone', device });
        expect(JSON.stringify(promoted.view)).not.toContain('deviceId');

        const restored = withViewAsNode(promoted.views, 'phone', 'a', { x: 20, y: 30 })!;
        expect(restored.node).toMatchObject({ id: 'phone', kind: 'device', device, x: 20, y: 30, w: 360, h: 720 });
    });

    test('a drawing is a file, so it is never put on a canvas as itself', () => {
        const views: ProjectView[] = [canvas('a'), { kind: 'drawing', id: 'd', name: 'Sketch' }];
        expect(withViewAsNode(views, 'd', 'a', { x: 0, y: 0 })).toBeNull();
    });
});

describe('moving a node to another canvas', () => {
    test('it keeps its id and leaves its lines behind', () => {
        const source: ProjectCanvasView = {
            ...canvas('a', [node('n1')]),
            texts: [{ id: 't1', x: 0, y: 0, text: 'hi', size: 16 }],
            edges: [{ id: 'e1', from: 'n1', to: 't1' }]
        };
        const result = withNodeOnView([source, canvas('b')], 'n1', 'b', { x: 5, y: 6 })!;
        expect((result.views[0] as ProjectCanvasView).nodes).toEqual([]);
        expect((result.views[0] as ProjectCanvasView).edges).toEqual([]);
        expect((result.views[1] as ProjectCanvasView).nodes[0]).toMatchObject({ id: 'n1', x: 5, y: 6 });
    });

    test('a canvas is never moved into itself, and a view that is not one takes nothing', () => {
        const views = [canvas('a', [node('n1')]), canvas('b')];
        expect(withNodeOnView(views, 'n1', 'a')).toBeNull();
        expect(withNodeOnView(views, 'n1', 'gone')).toBeNull();
    });
});

describe('what a view keeps running', () => {
    test('a canvas answers for its shells and its agents, and for nothing that only draws', () => {
        const view = canvas('a', [node('n1'), node('n2', 'chat'), node('n3', 'browser'), node('n4', 'note')]);
        expect(sessionNodesOfView(view)).toEqual([
            { id: 'n1', kind: 'terminal' },
            { id: 'n2', kind: 'chat' }
        ]);
    });

    test('a view of its own is the one daemon session it is; browsers, devices and files are none', () => {
        expect(sessionNodesOfView({ kind: 'chat', id: 'c1', name: 'Planner', node: {} })).toEqual([{ id: 'c1', kind: 'chat' }]);
        expect(sessionNodesOfView({ kind: 'browser', id: 'p1', name: 'Page', url: 'https://bas.dev' })).toEqual([]);
        expect(
            sessionNodesOfView({
                kind: 'device',
                id: 'phone',
                name: 'iPhone',
                device: { platform: 'ios', kind: 'simulator', name: 'iPhone', runtime: 'iOS 27.0' }
            })
        ).toEqual([]);
        expect(sessionNodesOfView({ kind: 'drawing', id: 'd1', name: 'Sketch' })).toEqual([]);
        expect(sessionNodesOfView({ kind: 'separator', id: 'sep' })).toEqual([]);
    });
});

describe('who made a view', () => {
    test('createdBy survives a round trip through the document schema, on every kind and on a separator', () => {
        const views: ProjectView[] = [
            { ...emptyCanvasView('a', 'Canvas'), createdBy: 'term-1' },
            { kind: 'separator', id: 'sep', createdBy: 'term-1' },
            { kind: 'chat', id: 'c1', name: 'Planner', node: {}, createdBy: 'term-1' },
            { kind: 'drawing', id: 'd1', name: 'Sketch', createdBy: 'term-1' },
            { kind: 'file', id: 'f1', name: 'main.ts', path: 'src/main.ts', createdBy: 'term-1' },
            { kind: 'browser', id: 'p1', name: 'Page', url: 'https://bas.dev', createdBy: 'term-1' },
            {
                kind: 'device',
                id: 'phone',
                name: 'iPhone',
                device: { platform: 'ios', kind: 'simulator', name: 'iPhone', runtime: 'iOS 27.0' },
                createdBy: 'term-1'
            },
            { kind: 'terminal', id: 't1', name: 'Shell', node: {}, createdBy: 'term-1' }
        ];
        const parsed = ProjectDocumentSchema.parse({ version: 3, rev: 1, name: 'repo', color: '#123456', views });
        expect(parsed.views.map((view) => view.createdBy)).toEqual(views.map(() => 'term-1'));
    });

    test('a view nobody wrote down carries nothing, which is what a person making one looks like', () => {
        const parsed = ProjectDocumentSchema.parse({ version: 3, rev: 1, name: 'repo', color: '#123456', views: [emptyCanvasView('a', 'Canvas')] });
        expect(parsed.views[0]!.createdBy).toBeUndefined();
    });
});
