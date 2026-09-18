import { DrawingDocumentSchema, DiagramDocumentSchema, RenderSceneResultSchema } from '../../../../../packages/contracts/src/index.ts';
import { renderDrawing, renderDiagram } from '@ruimte/render';
const cases: unknown[] = [];
const drawing = (name: string, elements: unknown[]) => {
    const input = DrawingDocumentSchema.parse({ version: 1, rev: 7, elements });
    cases.push({ name, kind: 'drawing', input, output: RenderSceneResultSchema.parse(renderDrawing(input)) });
};
const base = { id: 'a', x: 40, y: -20, w: 160, h: 80, stroke: 'blue', strokeWidth: 2, seed: 28 };
drawing('empty', []);
for (const kind of ['rect', 'diamond', 'ellipse']) {
    for (const roughness of [0, 1, 2])
        for (const fill of ['none', 'solid', 'hachure']) {
            drawing(`${kind}-${roughness}-${fill}`, [{ ...base, kind, roughness, fill, fillColor: 'green', angle: 0.3 }]);
        }
}
drawing('rounded', [{ ...base, kind: 'rect', radius: 16, fill: 'solid' }]);
for (const strokeStyle of ['solid', 'dashed', 'dotted'])
    drawing(`line-${strokeStyle}`, [
        {
            ...base,
            kind: 'line',
            strokeStyle,
            points: [
                [0, 0],
                [35, 60],
                [120, 20]
            ],
            arrowStart: true,
            arrowEnd: true
        }
    ]);
for (const pressure of [false, true])
    drawing(`freehand-${pressure}`, [
        {
            ...base,
            kind: 'freehand',
            points: pressure
                ? [
                      [0, 0, 0.2],
                      [20, 15, 0.8],
                      [50, 0, 0.5]
                  ]
                : [
                      [0, 0],
                      [20, 15],
                      [50, 0]
                  ]
        }
    ]);
for (const kind of ['text', 'note'])
    for (const font of ['hand', 'mono', 'sans'])
        for (const align of ['left', 'center', 'right'])
            drawing(`${kind}-${font}-${align}`, [
                { ...base, kind, font, align, text: 'A long line with words\n界 😀 second line', size: 20, angle: Math.PI / 2, fillColor: 'yellow' }
            ]);
for (const direction of ['right', 'down']) {
    for (const cycle of [false, true]) {
        const input = DiagramDocumentSchema.parse({
            version: 1,
            rev: 8,
            meta: { title: 'Flow', direction },
            nodes: ['rect', 'round', 'pill', 'diamond', 'cylinder'].map((shape, i) => ({
                id: `n${i}`,
                label: `Node ${i}`,
                shape,
                sub: i === 0 ? 'Details' : undefined,
                pos: i === 4 ? [700, 300] : undefined
            })),
            groups: [{ id: 'g', label: 'System', wraps: ['n0', 'n1'], tone: 'purple' }],
            edges: [
                { from: 'n0', to: 'n1', label: 'Reads', style: 'dashed' },
                { from: 'n1', to: 'n2' },
                { from: 'n1', to: 'n3', style: 'dotted' },
                ...(cycle ? [{ from: 'n3', to: 'n0' }] : [])
            ]
        });
        cases.push({ name: `diagram-${direction}-${cycle}`, kind: 'diagram', input, output: RenderSceneResultSchema.parse(renderDiagram(input)) });
    }
}
await Bun.write(new URL('./render-oracle.json', import.meta.url), JSON.stringify(cases, null, 2));
console.log(JSON.stringify({ cases: cases.length }));
