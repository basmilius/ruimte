import type { DiagramEdgeStyle, DiagramShape } from '@ruimte/contracts';
import { CYLINDER_LID, EDGE_LABEL_PADDING, type EdgeLabelBox, type NodeBox, type Point, type Rect } from './layout.ts';
import { LABEL_LINE, LABEL_SIZE, SUB_LINE, SUB_SIZE } from './text.ts';

const ROUND_RADIUS = 10;
/* How deep the lid of a cylinder is, as a share of its height. */
const LID_RATIO = 0.18;
const HEAD_LENGTH = 10;
const HEAD_WIDTH = 6;

export interface ShapePaths {
    /* The outline, filled and stroked. */
    body: string;
    /* A line drawn on top of the body and never filled: the front edge of a cylinder's lid. */
    detail: string | null;
}

const roundedRect = (box: Rect, radius: number): string => {
    const r = Math.round(Math.min(radius, box.w / 2, box.h / 2));
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    return [
        `M${box.x + r} ${box.y}`,
        `H${right - r}`,
        `A${r} ${r} 0 0 1 ${right} ${box.y + r}`,
        `V${bottom - r}`,
        `A${r} ${r} 0 0 1 ${right - r} ${bottom}`,
        `H${box.x + r}`,
        `A${r} ${r} 0 0 1 ${box.x} ${bottom - r}`,
        `V${box.y + r}`,
        `A${r} ${r} 0 0 1 ${box.x + r} ${box.y}`,
        'Z'
    ].join(' ');
};

/* The outline of a node's shape in its box, as SVG path data both the view and the export draw. */
export const shapePaths = (shape: DiagramShape | undefined, box: Rect): ShapePaths => {
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const middleX = Math.round(box.x + box.w / 2);
    const middleY = Math.round(box.y + box.h / 2);
    switch (shape ?? 'rect') {
        case 'round':
            return { body: roundedRect(box, ROUND_RADIUS), detail: null };
        case 'pill':
            return { body: roundedRect(box, box.h / 2), detail: null };
        case 'diamond':
            return { body: `M${middleX} ${box.y} L${right} ${middleY} L${middleX} ${bottom} L${box.x} ${middleY} Z`, detail: null };
        case 'cylinder': {
            const lid = Math.round(box.h * LID_RATIO);
            const rx = Math.round(box.w / 2);
            const ry = Math.round(lid / 2);
            const top = box.y + ry;
            const base = bottom - ry;
            return {
                body: `M${box.x} ${top} A${rx} ${ry} 0 0 1 ${right} ${top} V${base} A${rx} ${ry} 0 0 1 ${box.x} ${base} Z`,
                detail: `M${box.x} ${top} A${rx} ${ry} 0 0 0 ${right} ${top}`
            };
        }
        default:
            return { body: `M${box.x} ${box.y} H${right} V${bottom} H${box.x} Z`, detail: null };
    }
};

/* One line of text, positioned as a baseline and anchored in the middle. */
export interface TextLine {
    text: string;
    x: number;
    y: number;
    size: number;
    bold: boolean;
    /* The line under a node's label, drawn in the muted tone. */
    muted: boolean;
}

/* Where every line of a node's label and of the line under it sits, centered in the box as one block. */
export const textLinesOf = (box: Pick<NodeBox, 'x' | 'y' | 'w' | 'h' | 'label' | 'sub'>, shape?: DiagramShape): TextLine[] => {
    const x = Math.round(box.x + box.w / 2);
    const height = box.label.length * LABEL_LINE + box.sub.length * SUB_LINE;
    // The lid of a cylinder takes the top of the box, so its text sits below it.
    const top = Math.round(box.y + (box.h - height) / 2) + (shape === 'cylinder' ? CYLINDER_LID / 2 : 0);
    const label = box.label.map((text, index) => ({ text, x, y: top + index * LABEL_LINE + 14, size: LABEL_SIZE, bold: true, muted: false }));
    const subTop = top + box.label.length * LABEL_LINE;
    const sub = box.sub.map((text, index) => ({ text, x, y: subTop + index * SUB_LINE + 12, size: SUB_SIZE, bold: false, muted: true }));
    return [...label, ...sub];
};

/* The lines of an edge's label, centered in the box the layout gave it. */
export const edgeLabelLinesOf = (label: EdgeLabelBox): TextLine[] => {
    const x = Math.round(label.x + label.w / 2);
    return label.lines.map((text, index) => ({
        text,
        x,
        y: label.y + EDGE_LABEL_PADDING.y + index * SUB_LINE + 12,
        size: SUB_SIZE,
        bold: false,
        muted: false
    }));
};

export const edgePath = (points: readonly Point[]): string => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');

/* A closed triangle on the last point, pointing along the last segment. */
export const arrowHeadPath = (points: readonly Point[]): string => {
    const tip = points.at(-1)!;
    const before = points.at(-2) ?? tip;
    const length = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
    const ux = (tip.x - before.x) / length;
    const uy = (tip.y - before.y) / length;
    const baseX = tip.x - ux * HEAD_LENGTH;
    const baseY = tip.y - uy * HEAD_LENGTH;
    const round = Math.round;
    return `M${tip.x} ${tip.y} L${round(baseX - uy * HEAD_WIDTH)} ${round(baseY + ux * HEAD_WIDTH)} L${round(baseX + uy * HEAD_WIDTH)} ${round(baseY - ux * HEAD_WIDTH)} Z`;
};

/* The dash pattern of an edge style, or null for a solid line. */
export const dashOf = (style: DiagramEdgeStyle | undefined): string | null => {
    if (style === 'dashed') {
        return '8 6';
    }
    if (style === 'dotted') {
        return '2 5';
    }
    return null;
};
