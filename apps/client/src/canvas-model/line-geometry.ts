import type { ProjectCanvasLine } from '@ruimte/contracts';
import { snapPoint, snapToGrid, type Point, type Rect } from '@/canvas-model/math';

type LineEnds = Pick<ProjectCanvasLine, 'x' | 'y' | 'endX' | 'endY'>;
export const LINE_GRID = 4;

export function lineBounds(line: LineEnds): Rect {
    return { x: Math.min(line.x, line.endX), y: Math.min(line.y, line.endY), w: Math.abs(line.endX - line.x), h: Math.abs(line.endY - line.y) };
}

export function snapLine<T extends LineEnds>(line: T): T {
    return {
        ...line,
        x: snapToGrid(line.x, LINE_GRID),
        y: snapToGrid(line.y, LINE_GRID),
        endX: snapToGrid(line.endX, LINE_GRID),
        endY: snapToGrid(line.endY, LINE_GRID)
    };
}

export function constrainedLineEnd(from: Point, to: Point, shift: boolean): Point {
    if (!shift) {
        return snapPoint(to, LINE_GRID);
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = (Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * Math.PI) / 4;
    return snapPoint({ x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }, LINE_GRID);
}

export function lineDash(line: Pick<ProjectCanvasLine, 'strokeWidth' | 'strokeStyle'>): string | undefined {
    return line.strokeStyle === 'dashed'
        ? `${line.strokeWidth * 4} ${line.strokeWidth * 3}`
        : line.strokeStyle === 'dotted'
          ? `0 ${line.strokeWidth * 3}`
          : undefined;
}

export function lineArrow(at: Point, from: Point, width: number): string {
    const angle = Math.atan2(at.y - from.y, at.x - from.x);
    const size = 8 + width * 2;
    const back = { x: at.x - Math.cos(angle) * size, y: at.y - Math.sin(angle) * size };
    const side = { x: Math.sin(angle) * size * 0.45, y: -Math.cos(angle) * size * 0.45 };
    return `M${back.x + side.x},${back.y + side.y} L${at.x},${at.y} L${back.x - side.x},${back.y - side.y}`;
}
