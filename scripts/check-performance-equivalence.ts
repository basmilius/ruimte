import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/check-performance-equivalence.ts <baseline checkout>');
}

const root = resolve(import.meta.dir, '..');

async function load(folder: string) {
    const modules = await Promise.all([
        import(resolve(folder, 'apps/client/src/canvas/edge-lines.ts')),
        import(resolve(folder, 'apps/client/src/canvas/node-navigation.ts')),
        import(resolve(folder, 'apps/client/src/canvas/editable-gaps.ts')),
        import(resolve(folder, 'apps/server/src/git/status.ts')),
        import(resolve(folder, 'apps/client/src/canvas/stacking.ts'))
    ]);

    return Object.assign({}, ...modules);
}

const before = await load(resolve(baselineRoot));
const after = await load(root);
let seed = 20261031;

function random(limit: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % limit;
}

for (let sample = 0; sample < 1000; sample++) {
    const edges = Array.from({ length: random(80) }, () => ({
        id: `e${random(50)}`,
        from: `n${random(10)}`,
        to: `n${random(10)}`,
        label: random(2) ? 'label' : undefined
    }));
    deepStrictEqual(after.edgeLines(edges), before.edgeLines(edges), `edgeLines ${sample}`);
    const nodes = Array.from({ length: random(100) }, (_, index) => ({
        id: `n${sample % 4 === 0 ? index % 17 : index}`,
        kind: sample % 4 === 0 ? 'note' : random(3) ? 'note' : 'group',
        x: random(1000) - 500,
        y: random(1000) - 500,
        w: random(500),
        h: random(500),
        collapsed: random(2) === 0
    }));
    const stacked = Object.fromEntries(nodes.map((node, index) => [node.id, { ...node, kind: index % 5 === 0 ? 'browser' : node.kind }]));
    const order = [...nodes.map((node) => node.id), 'missing', ...(nodes.length > 0 ? [nodes[0]!.id] : [])];
    const hidden = new Set(order.filter((_, index) => index % 7 === 0));
    const ringed = new Set(order.filter((_, index) => index % 3 === 0));
    deepStrictEqual(after.stackingOrder(stacked, order), before.stackingOrder(stacked, order), `stackingOrder ${sample}`);
    deepStrictEqual(
        after.nodesOverBrowsers(stacked, order, hidden, ringed),
        before.nodesOverBrowsers(stacked, order, hidden, ringed),
        `nodesOverBrowsers ${sample}`
    );
    const origin = random(2) ? `n${random(50)}` : null;
    const center = { x: random(1000) - 500, y: random(1000) - 500 };

    for (const direction of ['up', 'down', 'left', 'right']) {
        deepStrictEqual(
            after.neighboringNode(nodes, origin, direction, center),
            before.neighboringNode(nodes, origin, direction, center),
            `navigation ${sample} ${direction}`
        );
    }

    const active = { id: 'active', kind: 'note', x: random(100), y: random(100), w: random(50), h: random(50) };
    deepStrictEqual(after.parentGroupOf(active, nodes), before.parentGroupOf(active, nodes), `parentGroupOf ${sample}`);
    const selection = sample % 3 === 0 ? [] : nodes.slice(0, sample % 3).map((node) => node.id);
    deepStrictEqual(after.editableGaps(nodes, selection), before.editableGaps(nodes, selection), `editableGaps ${sample}`);
    const fields = Array.from({ length: random(15) }, () => ['word', '', 'a b', '\n', 'é'][random(5)]).join(' ');
    const porcelain = ['1 ', '2 ', 'u '][random(3)] + fields + '\0original path\0';
    deepStrictEqual(after.parsePorcelain(porcelain), before.parsePorcelain(porcelain), `porcelain ${sample}`);
}

console.log(JSON.stringify({ seed: 20261031, samples: 1000, comparisons: 10000, result: 'identical' }));
