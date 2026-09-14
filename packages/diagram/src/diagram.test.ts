import { describe, expect, test } from 'bun:test';
import type { DiagramDocument, DiagramEdge, DiagramNode } from '@ruimte/contracts';
import { layersOf, layoutOf, type Rect } from './layout.ts';
import { readingOrder } from './reading-order.ts';
import { shapePaths } from './shapes.ts';
import { toSvg } from './svg.ts';

/* The example from the design report. */
const example: DiagramDocument = {
    version: 1,
    rev: 7,
    meta: { title: 'Ruimte op de draad', direction: 'right' },
    groups: [{ id: 'daemon', label: 'Daemon', wraps: ['sessions', 'projects'], tone: 'muted' }],
    nodes: [
        { id: 'client', label: 'Client', sub: 'React, Vite', tone: 'blue' },
        { id: 'sessions', label: 'SessionManager', sub: 'PTY per node' },
        { id: 'projects', label: 'ProjectStore', sub: '.ruimte/project.json', shape: 'cylinder' },
        { id: 'cli', label: 'Claude Code', shape: 'pill', tone: 'muted' }
    ],
    edges: [
        { from: 'client', to: 'sessions', label: 'session.attach', tone: 'accent' },
        { from: 'sessions', to: 'projects' },
        { from: 'cli', to: 'sessions', label: 'hooks', style: 'dashed' }
    ]
};

/* Edges as `from>to`, which keeps a graph on one line. */
const graph = (nodes: string[], edges: string[], direction: 'right' | 'down' = 'right'): DiagramDocument => ({
    version: 1,
    rev: 0,
    meta: { title: '', direction },
    nodes: nodes.map((id): DiagramNode => ({ id, label: id })),
    groups: [],
    edges: edges.map((edge): DiagramEdge => {
        const [from, to] = edge.split('>') as [string, string];
        return { from, to };
    })
});

const layerList = (document: DiagramDocument): Record<string, number> => Object.fromEntries(layersOf(document.nodes, document.edges));

const contains = (outer: Rect, inner: Rect): boolean =>
    outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

const overlaps = (left: Rect, right: Rect): boolean =>
    left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;

describe('layers', () => {
    test('a layer is the longest path from a node without incoming edges', () => {
        expect(layerList(graph(['a', 'b', 'c', 'd'], ['a>b', 'b>c', 'a>c', 'd>c']))).toEqual({ a: 0, b: 1, c: 2, d: 0 });
    });

    test('a node nothing connects to sits in the first layer', () => {
        expect(layerList(graph(['a', 'b'], []))).toEqual({ a: 0, b: 0 });
    });

    test('a cycle with no source is broken at the first node in the file', () => {
        expect(layerList(graph(['a', 'b', 'c'], ['a>b', 'b>c', 'c>a']))).toEqual({ a: 0, b: 1, c: 2 });
        // The same cycle written in another order breaks somewhere else, and always at the same place.
        expect(layerList(graph(['c', 'a', 'b'], ['a>b', 'b>c', 'c>a']))).toEqual({ c: 0, a: 1, b: 2 });
    });

    test('a cycle behind a source is walked from that source', () => {
        expect(layerList(graph(['a', 'b', 'x'], ['a>b', 'b>a', 'x>a']))).toEqual({ x: 0, a: 1, b: 2 });
    });

    test('a loop on one node and two cycles sharing a node still finish', () => {
        const document = graph(['a', 'b', 'c', 'd'], ['a>a', 'a>b', 'b>a', 'b>c', 'c>b', 'c>d']);
        expect(layerList(document)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    });

    test('a chain far longer than any stack still gets its layers', () => {
        const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
        const edges = ids.slice(1).map((id, i) => `${ids[i]}>${id}`);
        expect(layersOf(graph(ids, edges).nodes, graph(ids, edges).edges).get('n19999')).toBe(19999);
    });
});

describe('layoutOf', () => {
    test('the same document gives the same coordinates twice, and from a copy of itself', () => {
        const first = layoutOf(example);
        expect(layoutOf(example)).toEqual(first);
        expect(layoutOf(JSON.parse(JSON.stringify(example)) as DiagramDocument)).toEqual(first);
    });

    test('every coordinate is a whole number', () => {
        for (const direction of ['right', 'down'] as const) {
            const layout = layoutOf({ ...example, meta: { ...example.meta, direction } });
            const numbers = [
                ...layout.nodes.flatMap((box) => [box.x, box.y, box.w, box.h]),
                ...layout.groups.flatMap((box) => [box.x, box.y, box.w, box.h]),
                ...layout.edges.flatMap((edge) => [...edge.points.flatMap((point) => [point.x, point.y]), edge.labelAt.x, edge.labelAt.y]),
                layout.bounds.x,
                layout.bounds.y,
                layout.bounds.w,
                layout.bounds.h
            ];
            expect(numbers.every(Number.isInteger)).toBe(true);
        }
    });

    test('layers run along the direction and the file order runs across it', () => {
        const right = layoutOf(graph(['a', 'b', 'c'], ['a>b', 'a>c']));
        const [a, b, c] = right.nodes;
        expect(b!.x).toBeGreaterThan(a!.x + a!.w);
        expect(b!.x).toBe(c!.x);
        expect(c!.y).toBeGreaterThan(b!.y + b!.h);

        const down = layoutOf(graph(['a', 'b', 'c'], ['a>b', 'a>c'], 'down'));
        const [da, db, dc] = down.nodes;
        expect(db!.y).toBeGreaterThan(da!.y + da!.h);
        expect(db!.y).toBe(dc!.y);
        expect(dc!.x).toBeGreaterThan(db!.x + db!.w);
    });

    test('a node with a position sits there and gives its place in the layer up', () => {
        const document = graph(['a', 'b', 'c'], ['a>b', 'a>c']);
        document.nodes[1] = { ...document.nodes[1]!, pos: [500, -300] };
        const layout = layoutOf(document);
        expect(layout.nodes[1]).toMatchObject({ id: 'b', x: 500, y: -300, pinned: true });
        expect(layout.nodes[2]!.y).toBe(0);
    });

    test('a group encloses what it wraps and nothing it does not', () => {
        const layout = layoutOf(example);
        const group = layout.groups[0]!;
        const byId = new Map(layout.nodes.map((box) => [box.id, box]));
        expect(contains(group, byId.get('sessions')!)).toBe(true);
        expect(contains(group, byId.get('projects')!)).toBe(true);
        expect(overlaps(group, byId.get('client')!)).toBe(false);
    });

    test('an edge starts on its source and ends on its target, and one pointing back goes around', () => {
        const layout = layoutOf(graph(['a', 'b'], ['a>b', 'b>a']));
        const [a, b] = layout.nodes;
        const [forward, back] = layout.edges;
        expect(forward!.points[0]).toEqual({ x: a!.x + a!.w, y: a!.y + a!.h / 2 });
        expect(forward!.points.at(-1)).toEqual({ x: b!.x, y: b!.y + b!.h / 2 });
        expect(Math.max(...back!.points.map((point) => point.y))).toBeGreaterThan(Math.max(a!.y + a!.h, b!.y + b!.h));
    });

    test('two ends a few units apart across the flow are one straight line', () => {
        const document = graph(['a', 'b'], ['a>b'], 'down');
        document.nodes[0] = { id: 'a', label: 'A somewhat longer label' };
        const [edge] = layoutOf(document).edges;
        expect(edge!.points).toHaveLength(2);
        expect(edge!.points[0]!.x).toBe(edge!.points[1]!.x);
    });

    test('an empty diagram lays out as nothing', () => {
        expect(layoutOf(graph([], []))).toEqual({ nodes: [], groups: [], edges: [], bounds: { x: 0, y: 0, w: 0, h: 0 } });
    });
});

describe('toSvg', () => {
    test('draws every node, edge and group in palette values and escapes what the file says', () => {
        const svg = toSvg({ ...example, nodes: [...example.nodes, { id: 'amp', label: 'A & <B>' }] }, { background: '#ffffff' });
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
        expect(svg).toContain('SessionManager');
        expect(svg).toContain('A &amp; &lt;B&gt;');
        expect(svg).toContain('stroke-dasharray="8 6"');
        expect(svg).toContain('#2563eb');
        expect(svg).not.toContain('NaN');
        expect(svg).not.toContain('undefined');
    });

    test('every shape has an outline and only a cylinder has a lid', () => {
        const box = { x: 0, y: 0, w: 120, h: 60 };
        for (const shape of ['rect', 'round', 'pill', 'diamond', 'cylinder'] as const) {
            const paths = shapePaths(shape, box);
            expect(paths.body).toEndWith('Z');
            expect(paths.detail === null).toBe(shape !== 'cylinder');
        }
    });
});

describe('readingOrder', () => {
    test('nodes layer by layer, then edges by name, then groups', () => {
        expect(readingOrder(example)).toEqual([
            'Client (React, Vite)',
            'Claude Code',
            'SessionManager (PTY per node)',
            'ProjectStore (.ruimte/project.json)',
            'Client -> SessionManager: session.attach',
            'SessionManager -> ProjectStore',
            'Claude Code -> SessionManager: hooks',
            'Daemon wraps: SessionManager, ProjectStore'
        ]);
    });
});
