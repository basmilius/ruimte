import { SIDE_NORMAL, type Side } from '@/canvas/edge-route';
import { markerPath, type MarkerShape } from '@/canvas/marker-path';
import type { Point } from '@/canvas/math';

/* The rim of a marker, in screen pixels: the same weight as the line it closes off. */
const MARKER_STROKE = 2;

const ORIGIN: Point = { x: 0, y: 0 };

/*
 * Where a line meets a node: it stops a gap short and leaves its marker in the gap behind, rimmed in
 * its own color, so nothing is ever drawn against a node's border. An outline is filled with the
 * canvas, so the line ends inside it instead of running through it.
 *
 * The shape is built around the origin and put in place by the transform, which is what keeps it the
 * same size on screen at every zoom while where it sits stays in the world.
 */
export function EdgeMarker({ shape, at, side, stroke, zoom }: { shape: MarkerShape; at: Point; side: Side; stroke: string; zoom: number }) {
    const path = markerPath(shape, ORIGIN, SIDE_NORMAL[side]);
    if (path === '') {
        return null;
    }
    const fill = shape === 'chevron' ? 'none' : shape === 'arrow' ? stroke : 'var(--canvas-bg)';
    return (
        <path
            d={path}
            transform={`translate(${at.x} ${at.y}) scale(${1 / zoom})`}
            fill={fill}
            stroke={stroke}
            strokeWidth={MARKER_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    );
}
