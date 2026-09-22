import type { Rect } from '@/canvas/math';

/* A node standing on a page, as the shape the page has to leave open for it. */
export interface PageHole extends Rect {
    /* The corner of the node, so its rounding is not cut square out of the page. */
    radius: number;
}

interface Corners {
    tl: number;
    tr: number;
    br: number;
    bl: number;
}

const round = (value: number): number => Math.round(value);

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/*
 * A hole inside the page, with a corner left square wherever the page's own edge already cuts it.
 * Null for a node that fell off the page entirely.
 */
const shapeOf = (hole: PageHole, width: number, height: number): { rect: Rect; corners: Corners } | null => {
    const left = Math.max(0, round(hole.x));
    const top = Math.max(0, round(hole.y));
    const right = Math.min(width, round(hole.x + hole.w));
    const bottom = Math.min(height, round(hole.y + hole.h));
    if (right <= left || bottom <= top) {
        return null;
    }
    const rect = { x: left, y: top, w: right - left, h: bottom - top };
    const radius = Math.min(hole.radius, rect.w / 2, rect.h / 2);
    const cut = { left: hole.x < 0, top: hole.y < 0, right: hole.x + hole.w > width, bottom: hole.y + hole.h > height };
    return {
        rect,
        corners: {
            tl: cut.left || cut.top ? 0 : radius,
            tr: cut.right || cut.top ? 0 : radius,
            br: cut.right || cut.bottom ? 0 : radius,
            bl: cut.left || cut.bottom ? 0 : radius
        }
    };
};

const roundedPath = (rect: Rect, corners: Corners): string => {
    const { x, y, w, h } = rect;
    const arc = (radius: number, toX: number, toY: number): string => (radius > 0 ? `A${radius},${radius} 0 0 1 ${toX},${toY}` : '');
    return [
        `M${x + corners.tl},${y}`,
        `H${x + w - corners.tr}`,
        arc(corners.tr, x + w, y + corners.tr),
        `V${y + h - corners.br}`,
        arc(corners.br, x + w - corners.br, y + h),
        `H${x + corners.bl}`,
        arc(corners.bl, x, y + h - corners.bl),
        `V${y + corners.tl}`,
        arc(corners.tl, x + corners.tl, y),
        'Z'
    ]
        .filter((part) => part !== '')
        .join(' ');
};

/* Holes that cross each other, as one group each. A group of one keeps its shape; the rest is cut. */
const groupsOf = (holes: readonly Rect[]): Rect[][] => {
    const groups: Rect[][] = [];
    for (const hole of holes) {
        const touching = groups.filter((group) => group.some((other) => overlaps(hole, other)));
        for (const group of touching) {
            groups.splice(groups.indexOf(group), 1);
        }
        groups.push([hole, ...touching.flat()]);
    }
    return groups;
};

/*
 * The same area as the rectangles given, as rectangles that never overlap. A path is filled with the
 * even-odd rule, which fills the place where two holes cross, so the holes are cut along each
 * other's edges first. Neighbours in a row are put back together, which is the whole hole again
 * wherever nothing crossed it.
 */
export const disjointRects = (rects: readonly Rect[]): Rect[] => {
    const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.w]))].sort((a, b) => a - b);
    const ys = [...new Set(rects.flatMap((rect) => [rect.y, rect.y + rect.h]))].sort((a, b) => a - b);
    const out: Rect[] = [];
    for (let row = 0; row < ys.length - 1; row++) {
        const y = ys[row]!;
        const h = ys[row + 1]! - y;
        let run: Rect | null = null;
        for (let column = 0; column < xs.length - 1; column++) {
            const x = xs[column]!;
            const w = xs[column + 1]! - x;
            const inside = rects.some((rect) => rect.x <= x && rect.y <= y && rect.x + rect.w >= x + w && rect.y + rect.h >= y + h);
            if (!inside) {
                run = null;
                continue;
            }
            if (run === null) {
                run = { x, y, w, h };
                out.push(run);
            } else {
                run.w += w;
            }
        }
    }
    return out;
};

/*
 * The page with a hole for everything standing on top of it, in the page's own pixels. Null where
 * nothing covers it, which is the page as it is. A hole keeps the corner of its node, unless it
 * crosses another hole: the two are cut along each other's edges there, since even-odd would
 * otherwise fill the piece they share.
 */
export const pageClipPath = (width: number, height: number, holes: readonly PageHole[]): string | null => {
    const shapes = holes.map((hole) => shapeOf(hole, width, height)).filter((shape): shape is { rect: Rect; corners: Corners } => shape !== null);
    if (shapes.length === 0) {
        return null;
    }
    const parts = [`M0,0 H${width} V${height} H0 Z`];
    for (const group of groupsOf(shapes.map((shape) => shape.rect))) {
        const alone = group.length === 1 ? shapes.find((shape) => shape.rect === group[0]) : undefined;
        if (alone !== undefined) {
            parts.push(roundedPath(alone.rect, alone.corners));
            continue;
        }
        for (const piece of disjointRects(group)) {
            parts.push(`M${piece.x},${piece.y} H${piece.x + piece.w} V${piece.y + piece.h} H${piece.x} Z`);
        }
    }
    return `path(evenodd, "${parts.join(' ')}")`;
};
