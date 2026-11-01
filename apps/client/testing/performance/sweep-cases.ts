import { measurePairs, type PerformanceCase } from './paired';

interface SweepApi {
    edgeLines: typeof import('../../src/canvas/edge-lines').edgeLines;
    neighboringNode: typeof import('../../src/canvas/node-navigation').neighboringNode;
    parentGroupOf: typeof import('../../src/canvas/editable-gaps').parentGroupOf;
    editableGaps: typeof import('../../src/canvas/editable-gaps').editableGaps;
    base64Of: typeof import('../../src/base64').base64Of;
}

export function measureGapSweep(before: Pick<SweepApi, 'parentGroupOf' | 'editableGaps'>, after: Pick<SweepApi, 'parentGroupOf' | 'editableGaps'>) {
    const cases: PerformanceCase[] = [];

    for (const size of [10, 100, 500]) {
        const nodes = Array.from({ length: size }, (_, index) => ({
            id: `node-${index}`,
            kind: 'note',
            x: (index % 20) * 160,
            y: Math.floor(index / 20) * 140,
            w: 100,
            h: 80
        }));

        cases.push({
            name: `parentGroupOf/no-groups/${size}`,
            before: () => before.parentGroupOf(nodes[0]!, nodes),
            after: () => after.parentGroupOf(nodes[0]!, nodes)
        });

        for (const selection of [[], [nodes[0]!.id], nodes.slice(0, Math.min(size, 10)).map((node) => node.id)]) {
            cases.push({
                name: `editableGaps/${size}/selected-${selection.length}`,
                before: () => before.editableGaps(nodes, selection),
                after: () => after.editableGaps(nodes, selection)
            });
        }
    }

    for (const size of [10, 100, 500]) {
        const overlap = Array.from({ length: size }, (_, index) => ({ id: `node-${index}`, kind: 'note', x: 0, y: 0, w: 100, h: 80 }));
        const mixed = overlap.map((node, index) => ({
            ...node,
            kind: index % 10 === 0 ? 'line' : 'note',
            x: (index % 20) * 160,
            y: Math.floor(index / 20) * 140
        }));

        for (const [name, nodes] of [
            ['overlapping', overlap],
            ['lines', mixed]
        ] as const) {
            cases.push({ name: `editableGaps/${size}/${name}`, before: () => before.editableGaps(nodes, []), after: () => after.editableGaps(nodes, []) });
        }
    }

    return measurePairs(cases);
}

export function measureEdgeSweep(before: Pick<SweepApi, 'edgeLines'>, after: Pick<SweepApi, 'edgeLines'>) {
    const cases: PerformanceCase[] = [];

    for (const size of [0, 1, 2, 10, 25, 32, 63, 64, 100, 1000, 5000]) {
        const edges = Array.from({ length: size }, (_, index) => ({
            id: `edge-${index}`,
            from: `node-${Math.floor(index / 2) + (index % 2)}`,
            to: `node-${Math.floor(index / 2) + 1 - (index % 2)}`
        }));

        cases.push({ name: `edgeLines/${size}`, before: () => before.edgeLines(edges), after: () => after.edgeLines(edges) });
    }

    return measurePairs(cases);
}

export function measureClientSweep(before: SweepApi, after: SweepApi) {
    const cases: PerformanceCase[] = [];

    for (const size of [100, 1000, 5000]) {
        const edges = Array.from({ length: size }, (_, index) => ({
            id: `edge-${index}`,
            from: `node-${Math.floor(index / 2)}`,
            to: `node-${Math.floor(index / 2) + 1}`
        }));

        for (let index = 1; index < size; index += 2) {
            [edges[index]!.from, edges[index]!.to] = [edges[index]!.to, edges[index]!.from];
        }

        const nodes = Array.from({ length: size }, (_, index) => ({
            id: `node-${index}`,
            kind: 'group',
            x: 0,
            y: 0,
            w: 100 + ((index * 7919) % size),
            h: 100 + ((index * 7919) % size)
        }));

        const active = { id: 'active', kind: 'note', x: 5, y: 5, w: 10, h: 10 };

        cases.push(
            { name: `edgeLines/${size}`, before: () => before.edgeLines(edges), after: () => after.edgeLines(edges) },
            { name: `parentGroupOf/${size}`, before: () => before.parentGroupOf(active, nodes), after: () => after.parentGroupOf(active, nodes) },
            {
                name: `neighboringNode/initial/${size}`,
                before: () => before.neighboringNode(nodes, null, 'right', { x: 150, y: 150 }),
                after: () => after.neighboringNode(nodes, null, 'right', { x: 150, y: 150 })
            },
            {
                name: `neighboringNode/right/${size}`,
                before: () => before.neighboringNode(nodes, 'node-0', 'right', { x: 150, y: 150 }),
                after: () => after.neighboringNode(nodes, 'node-0', 'right', { x: 150, y: 150 })
            }
        );
    }

    for (const size of [1024, 65536, 1048576]) {
        const bytes = new Uint8Array(size + 16).subarray(8, size + 8);

        for (let index = 0; index < size; index++) {
            bytes[index] = index % 256;
        }

        cases.push({ name: `base64Of/${size}`, before: () => before.base64Of(bytes), after: () => after.base64Of(bytes) });
    }

    return measurePairs(cases);
}
