import { GRID, intersects, snapToGrid, type Point, type Rect } from '@/canvas/math';

const GAP = GRID * 5;

const withGap = (rect: Rect): Rect => ({ x: rect.x - GAP, y: rect.y - GAP, w: rect.w + GAP * 2, h: rect.h + GAP * 2 });

export const nearestFreeNodeRect = (existing: readonly Rect[], size: Pick<Rect, 'w' | 'h'>, preferredCenter: Point): Rect => {
    const origin = {
        x: snapToGrid(preferredCenter.x - size.w / 2),
        y: snapToGrid(preferredCenter.y - size.h / 2)
    };
    const stepX = size.w + GAP;
    const stepY = size.h + GAP;
    const occupied = existing.map(withGap);
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
};
