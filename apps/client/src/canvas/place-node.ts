import { GRID, intersects, snapToGrid, type Point, type Rect } from '@/canvas-model/math';

const GAP = GRID * 5;
/* Spots tried inside the view, so a canvas zoomed far out does not test tens of thousands of them. */
const MAX_SPOTS_IN_VIEW = 2500;

function withGap(rect: Rect): Rect {
    return { x: rect.x - GAP, y: rect.y - GAP, w: rect.w + GAP * 2, h: rect.h + GAP * 2 };
}

export function liesWithin(area: Rect, rect: Rect): boolean {
    return rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h;
}

/* The free spot wholly inside `visible` closest to `origin`, or null when none is left. */
function freeRectInView(occupied: readonly Rect[], size: Pick<Rect, 'w' | 'h'>, origin: Point, visible: Rect): Rect | null {
    const room = { w: visible.w - size.w, h: visible.h - size.h };
    if (room.w < 0 || room.h < 0) {
        return null;
    }
    // A step of whole grid cells from a snapped origin keeps every spot on the grid.
    const step = Math.max(GAP, snapToGrid(Math.sqrt((room.w * room.h) / MAX_SPOTS_IN_VIEW)));
    const columns = { from: Math.ceil((visible.x - origin.x) / step), to: Math.floor((visible.x + room.w - origin.x) / step) };
    const rows = { from: Math.ceil((visible.y - origin.y) / step), to: Math.floor((visible.y + room.h - origin.y) / step) };
    let best: Rect | null = null;
    let bestDistance = Infinity;
    for (let row = rows.from; row <= rows.to; row += 1) {
        for (let column = columns.from; column <= columns.to; column += 1) {
            const candidate = { x: origin.x + column * step, y: origin.y + row * step, ...size };
            const distance = (candidate.x - origin.x) ** 2 + (candidate.y - origin.y) ** 2;
            if (distance < bestDistance && !occupied.some((rect) => intersects(candidate, rect))) {
                best = candidate;
                bestDistance = distance;
            }
        }
    }
    return best;
}

/*
 * Where a node of `size` lands near `preferredCenter` without covering another. With `visible`, the
 * part of the canvas in view, a spot wholly in view wins over a nearer one partly out of it.
 */
export function nearestFreeNodeRect(existing: readonly Rect[], size: Pick<Rect, 'w' | 'h'>, preferredCenter: Point, visible?: Rect): Rect {
    const origin = {
        x: snapToGrid(preferredCenter.x - size.w / 2),
        y: snapToGrid(preferredCenter.y - size.h / 2)
    };
    const stepX = size.w + GAP;
    const stepY = size.h + GAP;
    const occupied = existing.map(withGap);
    const inView = visible === undefined ? null : freeRectInView(occupied, size, origin, visible);
    if (inView !== null) {
        return inView;
    }
    const limit = Math.max(4, Math.ceil(Math.sqrt(existing.length + 1)) + 2);

    for (let ring = 0; ring <= limit; ring += 1) {
        for (let row = -ring; row <= ring; row += 1) {
            for (let column = -ring; column <= ring; column += 1) {
                if (ring > 0 && Math.abs(row) !== ring && Math.abs(column) !== ring) {
                    continue;
                }
                const candidate = {
                    x: snapToGrid(origin.x + column * stepX),
                    y: snapToGrid(origin.y + row * stepY),
                    ...size
                };
                if (!occupied.some((rect) => intersects(candidate, rect))) {
                    return candidate;
                }
            }
        }
    }

    return {
        x: snapToGrid(Math.max(...existing.map((rect) => rect.x + rect.w), origin.x) + GAP),
        y: origin.y,
        ...size
    };
}
