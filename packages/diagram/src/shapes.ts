import type { DiagramEdgeStyle, DiagramShape } from '@ruimte/contracts';
import { LABEL_SIZE, SUB_SIZE, type Point, type Rect } from './layout.ts';

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

/* Where the label and the line under it sit, as text baselines centered in the box. */
export const textLinesOf = (box: Rect, hasSub: boolean, shape?: DiagramShape): { label: Point; sub: Point | null } => {
    const x = Math.round(box.x + box.w / 2);
    // The lid of a cylinder takes the top of the box, so its text sits a little lower.
    const middle = Math.round(box.y + box.h / 2) + (shape === 'cylinder' ? Math.round(box.h * LID_RATIO * 0.25) : 0);
    if (!hasSub) {
        return { label: { x, y: middle + Math.round(LABEL_SIZE * 0.35) }, sub: null };
    }
    return { label: { x, y: middle - 2 }, sub: { x, y: middle + SUB_SIZE + 2 } };
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
