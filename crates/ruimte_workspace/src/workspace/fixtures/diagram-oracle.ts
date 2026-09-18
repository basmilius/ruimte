import { DiagramDocumentSchema, RenderSceneResultSchema } from '../../../../../packages/contracts/src/index.ts';
import { renderDiagram } from '@ruimte/render';
const cases: any[] = [];
let seed = 0x19283746;
const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
};
const add = (name: string, nodes: any[], edges: any[], groups: any[] = []) => {
    for (const direction of ['right', 'down']) {
        const input = DiagramDocumentSchema.parse({ version: 1, rev: 1, meta: { title: name, direction }, nodes, edges, groups });
        cases.push({ name: `${name}/${direction}`, input, output: RenderSceneResultSchema.parse(renderDiagram(input)) });
    }
};
add('empty', [], []);
add('one node', [{ id: 'a', label: 'Only node' }], []);
add('self edge', [{ id: 'a', label: 'Loop', shape: 'diamond' }], [{ from: 'a', to: 'a', label: 'again' }]);
add(
    'disconnected multiline unicode',
    [
        { id: 'a', label: 'Long words\n界 😀', sub: 'Subheading\nSecond line', shape: 'cylinder' },
        { id: 'b', label: '', shape: 'pill' },
        { id: 'c', label: 'manual', pos: [-400, -200], shape: 'round' }
    ],
    [],
    [{ id: 'empty-group', label: 'Empty group', wraps: [] }]
);
for (let s = 0; s < 20; s++) {
    const n = 3 + Math.floor(random() * 10);
    const nodes = Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        label: i % 4 === 0 ? 'A longer wrapping label with words' : `Node ${i}`,
        shape: ['rect', 'round', 'pill', 'diamond', 'cylinder'][i % 5],
        ...(i % 3 === 0 ? { sub: `Details ${i} / 界` } : {}),
        ...(s % 3 === 0 && i === n - 1 ? { pos: [Math.floor(random() * 1200) - 200, Math.floor(random() * 800) - 200] } : {})
    }));
    const edges = [];
    for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
            if (i !== j && random() < 0.15)
                edges.push({
                    from: `n${i}`,
                    to: `n${j}`,
                    style: ['solid', 'dashed', 'dotted'][Math.floor(random() * 3)],
                    ...(random() < 0.4 ? { label: 'Transfer 界' } : {})
                });
    const groups =
        s % 2
            ? [
                  { id: 'g1', label: 'Group one', wraps: nodes.slice(0, 2).map((x) => x.id), tone: 'purple' },
                  { id: 'g2', label: 'Group two', wraps: nodes.slice(2, 4).map((x) => x.id), tone: 'blue' }
              ]
            : [];
    add(`seeded graph ${s}`, nodes, edges, groups);
}
await Bun.write(new URL('./diagram-oracle.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length }));
