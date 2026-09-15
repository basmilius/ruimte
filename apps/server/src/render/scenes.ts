import type {
    DiagramDocument,
    DrawingColor,
    DrawingDocument,
    DrawingElement,
    RenderColor,
    RenderElement,
    RenderPath,
    RenderSceneResult,
    RenderText
} from '@ruimte/contracts';
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
    layoutOf,
    shapePaths,
    textLinesOf
} from '@ruimte/diagram';
import { LINE_HEIGHT, approximateMeasure, centerOf, fontOf, linesOf, pathsOfElement, rotatePoint, unionOf, writingFrameOf } from '@ruimte/drawing';

const color = (tone: DrawingColor, palette: RenderColor['palette'] = 'ink'): RenderColor => ({ tone, palette });

const elementAtOrigin = (id: string, paths: RenderPath[], text: RenderText[]): RenderElement => ({
    id,
    x: 0,
    y: 0,
    angle: 0,
    centerX: 0,
    centerY: 0,
    paths,
    text
});

export const renderDiagram = (document: DiagramDocument): RenderSceneResult => {
    const layout = layoutOf(document);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const groups = new Map(document.groups.map((group) => [group.id, group]));
    const elements: RenderElement[] = [];
    for (const box of layout.groups) {
        const group = groups.get(box.id)!;
        const tone = color(group.tone ?? DEFAULT_GROUP_TONE);
        elements.push(
            elementAtOrigin(
                `group:${box.id}`,
                [
                    {
                        d: shapePaths('round', box).body,
                        stroke: tone,
                        fill: null,
                        strokeWidth: 1,
                        dash: [6, 4]
                    }
                ],
                [
                    {
                        text: group.label,
                        x: box.labelBox.x,
                        y: box.y + Math.round(GROUP_LABEL_BAND * 0.7),
                        size: SUB_SIZE,
                        bold: true,
                        align: 'left',
                        font: 'sans',
                        color: tone
                    }
                ]
            )
        );
    }
    for (const route of layout.edges) {
        const edge = document.edges[route.index]!;
        const tone = color(edge.tone ?? DEFAULT_EDGE_TONE);
        const dash = dashOf(edge.style)?.split(' ').map(Number) ?? null;
        const paths: RenderPath[] = [{ d: edgePath(route.points), stroke: tone, fill: null, strokeWidth: 2, dash }];
        if (route.points.length > 0) {
            paths.push({ d: arrowHeadPath(route.points), stroke: null, fill: tone, strokeWidth: 0, dash: null });
        }
        elements.push(
            elementAtOrigin(
                `edge:${route.index}`,
                paths,
                route.label
                    ? edgeLabelLinesOf(route.label).map((line) => ({
                          text: line.text,
                          x: line.x,
                          y: line.y,
                          size: line.size,
                          bold: line.bold,
                          align: 'center',
                          font: 'sans',
                          color: tone
                      }))
                    : []
            )
        );
    }
    for (const box of layout.nodes) {
        const node = nodes.get(box.id)!;
        const tone = node.tone ?? DEFAULT_NODE_TONE;
        const shape = shapePaths(node.shape, box);
        const paths: RenderPath[] = [{ d: shape.body, stroke: color(tone), fill: color(tone, 'paper'), strokeWidth: 2, dash: null }];
        if (shape.detail) {
            paths.push({ d: shape.detail, stroke: color(tone), fill: null, strokeWidth: 2, dash: null });
        }
        elements.push(
            elementAtOrigin(
                `node:${node.id}`,
                paths,
                textLinesOf(box, node.shape).map((line) => ({
                    text: line.text,
                    x: line.x,
                    y: line.y,
                    size: line.size,
                    bold: line.bold,
                    align: 'center',
                    font: 'sans',
                    color: color(line.muted ? 'muted' : 'ink')
                }))
            )
        );
    }
    return { rev: document.rev, bounds: layout.bounds, elements };
};

const drawingText = (element: DrawingElement): RenderText[] => {
    if (element.kind !== 'text' && element.kind !== 'note') {
        return [];
    }
    const frame = writingFrameOf(element);
    const x = frame.x + (element.align === 'center' ? frame.w / 2 : element.align === 'right' ? frame.w : 0);
    return linesOf(element, approximateMeasure(element.size, element.font)).map((text, index) => ({
        text,
        x,
        y: frame.y + (index + 0.8) * element.size * LINE_HEIGHT,
        size: element.size,
        bold: false,
        align: element.align ?? 'left',
        font: fontOf(element.font),
        color: color(element.stroke)
    }));
};

const drawingPaths = (element: DrawingElement): RenderPath[] =>
    pathsOfElement(element).map((path) => {
        const note = element.kind === 'note';
        if (path.role === 'stroke') {
            return {
                d: path.d,
                stroke: note ? color(element.fillColor ?? element.stroke, 'edge') : color(element.stroke),
                fill: null,
                strokeWidth: path.strokeWidth,
                dash: path.dash
            };
        }
        const fill = path.role === 'ink' ? color(element.stroke) : color(element.fillColor ?? element.stroke, note ? 'paper' : 'ink');
        const hachure = path.role === 'fill' && path.strokeWidth > 0 && element.fill === 'hachure';
        return { d: path.d, stroke: hachure ? fill : null, fill: hachure ? null : fill, strokeWidth: path.strokeWidth, dash: path.dash };
    });

export const renderDrawing = (document: DrawingDocument): RenderSceneResult => {
    const bounds = unionOf(
        document.elements.flatMap((element) => {
            const center = centerOf(element);
            return [
                [0, 0],
                [element.w, 0],
                [0, element.h],
                [element.w, element.h]
            ].map(([dx, dy]) => {
                const point = rotatePoint({ x: element.x + dx!, y: element.y + dy! }, center, element.angle ?? 0);
                return { ...point, w: 0, h: 0 };
            });
        })
    ) ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
        rev: document.rev,
        bounds,
        elements: document.elements.map((element) => ({
            id: element.id,
            x: element.x,
            y: element.y,
            angle: element.angle ?? 0,
            centerX: element.w / 2,
            centerY: element.h / 2,
            paths: drawingPaths(element),
            text: drawingText(element)
        }))
    };
};
