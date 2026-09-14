import { describe, expect, test } from 'bun:test';
import type { DiagramDocument, DiagramEdge, DiagramNode } from '@ruimte/contracts';
import wire from './fixtures/wire.json';
import { layersOf, layoutOf, sizeOfNode, type DiagramLayout, type Point, type Rect } from './layout.ts';
import { readingOrder } from './reading-order.ts';
import { shapePaths, textLinesOf } from './shapes.ts';
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

const whole = (rect: Rect): boolean => [rect.x, rect.y, rect.w, rect.h].every(Number.isInteger);

/* True when an axis-aligned segment enters the inside of a box, its outline not counted. */
const cuts = (start: Point, end: Point, box: Rect): boolean =>
    Math.max(start.x, end.x) > box.x &&
    Math.min(start.x, end.x) < box.x + box.w &&
    Math.max(start.y, end.y) > box.y &&
    Math.min(start.y, end.y) < box.y + box.h;

const segmentsOf = (points: readonly Point[]): [Point, Point][] => points.slice(1).map((point, index) => [points[index]!, point]);

/* Proper crossings between segments of different edges: a horizontal and a vertical meeting inside both. */
const crossingsOf = (layout: DiagramLayout): number => {
    let count = 0;
    const all = layout.edges.map((edge) => segmentsOf(edge.points));
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
            for (const [p0, p1] of all[i]!) {
                for (const [q0, q1] of all[j]!) {
                    const pFlat = p0.y === p1.y;
                    if (pFlat === (q0.y === q1.y)) {
                        continue;
                    }
                    const [h0, h1, v0, v1] = pFlat ? [p0, p1, q0, q1] : [q0, q1, p0, p1];
                    if (v0.x > Math.min(h0.x, h1.x) && v0.x < Math.max(h0.x, h1.x) && h0.y > Math.min(v0.y, v1.y) && h0.y < Math.max(v0.y, v1.y)) {
                        count += 1;
                    }
                }
            }
        }
    }
    return count;
};

const withDirection = (document: DiagramDocument, direction: 'right' | 'down'): DiagramDocument => ({ ...document, meta: { ...document.meta, direction } });

/* A small deterministic generator, so the graphs below are the same on every run. */
const randomGraphs = (count: number): DiagramDocument[] => {
    let seed = 7;
    const next = (limit: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % limit;
    };
    return Array.from({ length: count }, (_, index) => {
        const size = 4 + next(10);
        const ids = Array.from({ length: size }, (_, i) => `n${i}`);
        const edges = Array.from({ length: size + next(size) }, () => `${ids[next(size)]}>${ids[next(size)]}`);
        const document = graph(ids, edges, index % 2 === 0 ? 'right' : 'down');
        document.nodes = document.nodes.map((node, i) => ({
            ...node,
            label: i % 3 === 0 ? `A longer label for node ${i} that has to wrap` : node.label,
            shape: (['rect', 'round', 'pill', 'diamond', 'cylinder'] as const)[next(5)]
        }));
        document.edges = document.edges.map((edge, i) => (i % 2 === 0 ? { ...edge, label: `edge ${i}` } : edge));
        if (size > 6) {
            document.groups = [{ id: 'g', label: 'Group', wraps: [ids[1]!, ids[2]!] }];
        }
        return document;
    });
};

/* The promises every layout keeps, checked on one document. */
const expectReadable = (document: DiagramDocument): void => {
    const layout = layoutOf(document);
    const boxes = new Map(layout.nodes.map((box) => [box.id, box]));
    const labels = layout.edges.flatMap((edge) => (edge.label ? [edge.label] : []));
    for (const edge of layout.edges) {
        for (const box of layout.nodes) {
            if (box.id === edge.from || box.id === edge.to) {
                continue;
            }
            for (const [start, end] of segmentsOf(edge.points)) {
                expect({ edge: edge.index, node: box.id, cuts: cuts(start, end, box) }).toEqual({ edge: edge.index, node: box.id, cuts: false });
            }
        }
    }
    labels.forEach((label, index) => {
        expect(whole(label)).toBe(true);
        for (const box of layout.nodes) {
            expect({ label: label.lines.join(' '), node: box.id, overlaps: overlaps(label, box) }).toEqual({
                label: label.lines.join(' '),
                node: box.id,
                overlaps: false
            });
        }
        for (const group of layout.groups) {
            expect(overlaps(label, group.labelBox)).toBe(false);
        }
        for (const other of labels.slice(index + 1)) {
            expect({ label: label.lines.join(' '), other: other.lines.join(' '), overlaps: overlaps(label, other) }).toEqual({
                label: label.lines.join(' '),
                other: other.lines.join(' '),
                overlaps: false
            });
        }
    });
    for (const group of layout.groups) {
        const wraps = new Set(document.groups.find((candidate) => candidate.id === group.id)!.wraps);
        for (const box of layout.nodes) {
            if (!wraps.has(box.id)) {
                expect({ group: group.id, node: box.id, overlaps: overlaps(group, box) }).toEqual({ group: group.id, node: box.id, overlaps: false });
            }
        }
        for (const edge of layout.edges) {
            // An edge with an end inside the group crosses its border on the way; any other stays out of it.
            if (wraps.has(edge.from) || wraps.has(edge.to)) {
                continue;
            }
            for (const [start, end] of segmentsOf(edge.points)) {
                expect({ edge: edge.index, group: group.id, cuts: cuts(start, end, group) }).toEqual({ edge: edge.index, group: group.id, cuts: false });
            }
        }
    }
    expect(boxes.size).toBe(document.nodes.length);
};

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
                ...layout.edges.flatMap((edge) => [
                    ...edge.points.flatMap((point) => [point.x, point.y]),
                    ...(edge.label ? [edge.label.x, edge.label.y, edge.label.w, edge.label.h] : [])
                ]),
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

    test('an edge starts on its source and ends on its target', () => {
        const layout = layoutOf(graph(['a', 'b'], ['a>b']));
        const [a, b] = layout.nodes;
        const [forward] = layout.edges;
        expect(forward!.points[0]).toEqual({ x: a!.x + a!.w, y: a!.y + a!.h / 2 });
        expect(forward!.points.at(-1)).toEqual({ x: b!.x, y: b!.y + b!.h / 2 });
    });

    test('an edge pointing back leaves its source against the flow and arrives on the side of its target that faces the flow', () => {
        const layout = layoutOf(graph(['a', 'b'], ['a>b', 'b>a']));
        const [a, b] = layout.nodes;
        const back = layout.edges[1]!;
        expect(back.points[0]!.x).toBe(b!.x);
        expect(back.points.at(-1)!.x).toBe(a!.x + a!.w);
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

describe('a readable layout', () => {
    const fixture = wire as DiagramDocument;

    for (const direction of ['right', 'down'] as const) {
        test(`the demo diagram running ${direction} keeps every promise`, () => {
            expectReadable(withDirection(fixture, direction));
        });

        test(`the demo diagram running ${direction} is the same twice and in whole numbers`, () => {
            const document = withDirection(fixture, direction);
            const layout = layoutOf(document);
            expect(layoutOf(JSON.parse(JSON.stringify(document)) as DiagramDocument)).toEqual(layout);
            const rects = [
                ...layout.nodes,
                ...layout.groups,
                ...layout.groups.map((group) => group.labelBox),
                ...layout.edges.flatMap((edge) => (edge.label ? [edge.label] : []))
            ];
            expect(rects.every(whole)).toBe(true);
            expect(layout.edges.every((edge) => edge.points.every((point) => Number.isInteger(point.x) && Number.isInteger(point.y)))).toBe(true);
        });
    }

    test('the demo diagram crosses fewer lines than the first layout did', () => {
        // Counted on the layout of 574d50b with the same count: 3 running right, 2 running down.
        expect(crossingsOf(layoutOf(withDirection(fixture, 'right')))).toBeLessThan(3);
        expect(crossingsOf(layoutOf(withDirection(fixture, 'down')))).toBeLessThan(2);
    });

    test('every segment of an edge is horizontal or vertical', () => {
        for (const direction of ['right', 'down'] as const) {
            for (const edge of layoutOf(withDirection(fixture, direction)).edges) {
                expect(segmentsOf(edge.points).every(([start, end]) => start.x === end.x || start.y === end.y)).toBe(true);
            }
        }
    });

    test('generated graphs with cycles, long edges, groups and wrapped labels keep every promise', () => {
        for (const document of randomGraphs(40)) {
            expectReadable(document);
        }
    });

    test('an edge that skips layers runs between the boxes of the layers it passes', () => {
        const document = graph(['a', 'b', 'c', 'd'], ['a>b', 'b>c', 'c>d', 'a>d']);
        expectReadable(document);
        expectReadable(withDirection(document, 'down'));
    });

    test('a long label grows its box up to the widest and then wraps on words', () => {
        const short = sizeOfNode({ label: 'Client' });
        const long = sizeOfNode({ label: 'ruimte-context with a label that is deliberately far too long for its box' });
        expect(short.w).toBe(120);
        expect(long.w).toBeLessThanOrEqual(280);
        expect(long.label.length).toBeGreaterThan(1);
        expect(long.label.join(' ')).toBe('ruimte-context with a label that is deliberately far too long for its box');
        expect(long.h).toBeGreaterThan(short.h);
    });

    test('the painter draws every wrapped line the layout sized the box for', () => {
        const document: DiagramDocument = {
            ...graph(['a'], []),
            nodes: [{ id: 'a', label: 'one two three four five six seven eight nine ten eleven twelve' }]
        };
        const layout = layoutOf(document);
        const lines = textLinesOf(layout.nodes[0]!);
        expect(lines.length).toBe(layout.nodes[0]!.label.length);
        const svg = toSvg(document, { layout });
        for (const line of lines) {
            expect(svg).toContain(`>${line.text}</text>`);
        }
    });

    test('a chain of thousands of nodes lays out quickly', () => {
        const ids = Array.from({ length: 3000 }, (_, i) => `n${i}`);
        const document = graph(
            ids,
            ids.slice(1).map((id, i) => `${ids[i]}>${id}`)
        );
        const started = performance.now();
        const layout = layoutOf(document);
        expect(performance.now() - started).toBeLessThan(2000);
        expect(layout.nodes.at(-1)!.layer).toBe(2999);
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
