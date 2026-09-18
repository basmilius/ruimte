import type { Point } from '@/canvas/math';

/*
 * What a line wears where it meets a node. A line reads one way, which is its whole meaning, and the
 * marker is the only thing on screen that says which way: an end that reads gets a shape aimed into
 * it, an end that only gives gets a dot, which closes the line off without pointing anywhere.
 */
export type MarkerShape = 'none' | 'dot' | 'chevron' | 'arrow' | 'diamond';

/* The circle an end that points nowhere has always worn. */
const DOT_RADIUS = 5;

/* How far back along the line the arms of a chevron sit, and how far out to either side of it. */
const CHEVRON_BACK = 6;
const CHEVRON_SIDE = 6;

/* An arrow is longer and narrower than a chevron: it is filled, so it reads heavier at the same size. */
const ARROW_BACK = 10;
const ARROW_SIDE = 5;

/* A diamond sits around the endpoint the way the dot does, so the two swap without the line moving. */
const DIAMOND_ALONG = 6;
const DIAMOND_SIDE = 6;

/* Two decimals: a marker is built from a unit vector, and the float noise past that is not a pixel. */
const round = (value: number): number => Math.round(value * 100) / 100;

/*
 * The path of a marker at `at`, with `out` pointing away from the node it belongs to, so a shape with
 * a point aims back into that node. Only the direction of `out` is read, never its length.
 */
export const markerPath = (shape: MarkerShape, at: Point, out: Point): string => {
    const length = Math.hypot(out.x, out.y);
    if (shape === 'none' || length === 0) {
        return '';
    }
    const along = { x: out.x / length, y: out.y / length };
    const aside = { x: -along.y, y: along.x };
    // A corner of a marker, so far back along the direction it points and so far out to its side.
    const corner = (back: number, side: number): string => `${round(at.x + along.x * back + aside.x * side)} ${round(at.y + along.y * back + aside.y * side)}`;
    switch (shape) {
        case 'dot':
            // Two half circles: an arc taken twice is the only way to write a whole one as a path.
            return `M ${corner(-DOT_RADIUS, 0)} A ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${corner(DOT_RADIUS, 0)} A ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${corner(-DOT_RADIUS, 0)} Z`;
        case 'chevron':
            return `M ${corner(CHEVRON_BACK, CHEVRON_SIDE)} L ${corner(0, 0)} L ${corner(CHEVRON_BACK, -CHEVRON_SIDE)}`;
        case 'arrow':
            return `M ${corner(0, 0)} L ${corner(ARROW_BACK, ARROW_SIDE)} L ${corner(ARROW_BACK, -ARROW_SIDE)} Z`;
        case 'diamond':
            return `M ${corner(DIAMOND_ALONG, 0)} L ${corner(0, DIAMOND_SIDE)} L ${corner(-DIAMOND_ALONG, 0)} L ${corner(0, -DIAMOND_SIDE)} Z`;
    }
};
