import type { DiagramContent, DrawingColor } from '@ruimte/contracts';
import {
    DEFAULT_EDGE_TONE,
    DEFAULT_GROUP_TONE,
    DEFAULT_NODE_TONE,
    GROUP_LABEL_BAND,
    SUB_SIZE,
    arrowHeadPath,
    dashOf,
    edgeLabelLinesOf,
    edgePath,
    shapePaths,
    textLinesOf,
    type DiagramLayout
} from '@ruimte/diagram';

// The palette names resolve through the theme's own tokens, so a diagram follows light and dark.
const ink = (tone: DrawingColor): string => `var(--draw-${tone})`;
const paper = (tone: DrawingColor): string => `var(--draw-paper-${tone})`;

/* The graph as elements: the same layout and paths as the export, with the colors left to CSS. `interactive` is the view, where a node is dragged. */
export function DiagramScene({ content, layout, interactive = false }: { content: DiagramContent; layout: DiagramLayout; interactive?: boolean }) {
    const nodes = new Map(content.nodes.map((node) => [node.id, node]));
    const groups = new Map(content.groups.map((group) => [group.id, group]));
    return (
        <>
            {layout.groups.map((box) => {
                const group = groups.get(box.id)!;
                const tone = ink(group.tone ?? DEFAULT_GROUP_TONE);
                return (
                    <g key={box.id}>
                        <rect
                            x={box.x}
                            y={box.y}
                            width={box.w}
                            height={box.h}
                            rx={12}
                            strokeWidth={1}
                            strokeDasharray="6 4"
                            style={{ fill: 'none', stroke: tone }}
                        />
                        <text x={box.labelBox.x} y={box.y + Math.round(GROUP_LABEL_BAND * 0.7)} fontSize={SUB_SIZE} fontWeight={600} style={{ fill: tone }}>
                            {group.label}
                        </text>
                    </g>
                );
            })}
            {layout.edges.map((route) => {
                const edge = content.edges[route.index]!;
                const tone = ink(edge.tone ?? DEFAULT_EDGE_TONE);
                return (
                    <g key={route.index}>
                        <path
                            d={edgePath(route.points)}
                            strokeWidth={2}
                            strokeLinejoin="round"
                            strokeDasharray={dashOf(edge.style) ?? undefined}
                            style={{ fill: 'none', stroke: tone }}
                        />
                        <path d={arrowHeadPath(route.points)} style={{ fill: tone }} />
                        {route.label &&
                            edgeLabelLinesOf(route.label).map((line, index) => (
                                <text
                                    key={index}
                                    x={line.x}
                                    y={line.y}
                                    fontSize={line.size}
                                    textAnchor="middle"
                                    strokeWidth={4}
                                    style={{ fill: tone, stroke: 'var(--canvas-bg)', paintOrder: 'stroke' }}
                                >
                                    {line.text}
                                </text>
                            ))}
                    </g>
                );
            })}
            {layout.nodes.map((box) => {
                const node = nodes.get(box.id)!;
                const tone = node.tone ?? DEFAULT_NODE_TONE;
                const paths = shapePaths(node.shape, box);
                return (
                    // The mark is how the view finds the node under the pointer; the node on a canvas takes no pointer at all.
                    <g key={box.id} data-diagram-node={box.id} style={interactive ? { cursor: 'move' } : undefined}>
                        <path d={paths.body} strokeWidth={2} style={{ fill: paper(tone), stroke: ink(tone) }} />
                        {paths.detail && <path d={paths.detail} strokeWidth={2} style={{ fill: 'none', stroke: ink(tone) }} />}
                        {textLinesOf(box, node.shape).map((line, index) => (
                            <text
                                key={index}
                                x={line.x}
                                y={line.y}
                                fontSize={line.size}
                                fontWeight={line.bold ? 600 : undefined}
                                textAnchor="middle"
                                style={{ fill: ink(line.muted ? 'muted' : 'ink') }}
                            >
                                {line.text}
                            </text>
                        ))}
                    </g>
                );
            })}
        </>
    );
}
