import type { DrawingElement } from '@ruimte/contracts';
import type { Point, Rect } from '@ruimte/drawing';
import { snapToGrid } from '@/canvas/math';
import type { DrawingStyle, DrawingTool } from '@/state/drawing';

/* A click without a drag still makes a shape, in the size a shape usually starts at. */
export const DEFAULT_SHAPE = { w: 160, h: 96 };

/* Under this many world units a drag is a click, whatever the hand did. */
export const DRAG_THRESHOLD = 3;

/* A line snaps to this many degrees while Shift is held. */
const ANGLE_STEP = Math.PI / 12;

export const snapPoint = (point: Point, snap: boolean): Point => (snap ? { x: snapToGrid(point.x), y: snapToGrid(point.y) } : point);

/* The box of a shape being dragged: Shift makes it square, Alt grows it from where it started. */
export const shapeRect = (start: Point, current: Point, options: { square?: boolean; fromCenter?: boolean } = {}): Rect => {
    let dx = current.x - start.x;
    let dy = current.y - start.y;
    if (options.square) {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * side;
        dy = Math.sign(dy || 1) * side;
    }
    if (options.fromCenter) {
        return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
    }
    return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
};

/* The end of a line held to whole steps of 15 degrees, which is what Shift asks of it. */
export const constrainAngle = (start: Point, current: Point): Point => {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const angle = Math.round(Math.atan2(dy, dx) / ANGLE_STEP) * ANGLE_STEP;
    const length = Math.hypot(dx, dy);
    return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
};

const styleFields = (style: DrawingStyle): Pick<DrawingElement, 'stroke' | 'strokeWidth' | 'strokeStyle' | 'fill' | 'fillColor' | 'roughness'> => ({
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    fill: style.fill,
    fillColor: style.fillColor,
    roughness: style.roughness
});

/* A shape with the style that is up: what every drawing tool but freehand and text makes. */
export const shapeElement = (tool: DrawingTool, rect: Rect, style: DrawingStyle, id: string, seed: number): DrawingElement | null => {
    const base = { id, seed, ...rect, ...styleFields(style) };
    switch (tool) {
        case 'rect':
            return { kind: 'rect', ...base };
        case 'diamond':
            return { kind: 'diamond', ...base };
        case 'ellipse':
            return { kind: 'ellipse', ...base };
        default:
            return null;
    }
};

/* A line between two points, with a head at the end when the arrow tool drew it. */
export const lineElement = (tool: 'line' | 'arrow', from: Point, to: Point, style: DrawingStyle, id: string, seed: number): DrawingElement => ({
    kind: 'line',
    id,
    seed,
    x: from.x,
    y: from.y,
    w: to.x - from.x,
    h: to.y - from.y,
    ...styleFields(style),
    // No fill on a line, whatever the style panel holds for shapes.
    fill: 'none',
    points: [
        [0, 0],
        [to.x - from.x, to.y - from.y]
    ],
    ...(tool === 'arrow' ? { arrowEnd: true } : {})
});

export const textElement = (at: Point, style: DrawingStyle, id: string, seed: number): DrawingElement => ({
    kind: 'text',
    id,
    seed,
    x: at.x,
    y: at.y,
    w: DEFAULT_SHAPE.w,
    h: Math.round(style.textSize * 1.25),
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    text: '',
    size: style.textSize,
    font: style.font
});

/* Points rounded to a tenth of a unit and moved into the element's own frame, once a stroke ends. */
export const settleStroke = (element: DrawingElement & { kind: 'freehand' }): DrawingElement => {
    const xs = element.points.map(([x]) => x);
    const ys = element.points.map(([, y]) => y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const round = (value: number): number => Math.round(value * 10) / 10;
    return {
        ...element,
        x: element.x + left,
        y: element.y + top,
        w: Math.max(...xs) - left,
        h: Math.max(...ys) - top,
        // A mouse leaves no pressure, and an undefined third number is a null once the point is
        // JSON on the wire, which is not a number the schema will take.
        points: element.points.map(
            ([x, y, pressure]) =>
                (pressure === undefined ? [round(x - left), round(y - top)] : [round(x - left), round(y - top), pressure]) as [number, number, number?]
        )
    };
};
