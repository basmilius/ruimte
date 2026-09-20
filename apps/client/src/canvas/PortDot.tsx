import type { Point } from '@/canvas/math';

/* The ring at rest and what it grows to with the pointer on it, in screen pixels. */
const DOT_R = 5;
const DOT_R_NEAR = 7;

/* What takes the press, wider than the ring: what a person aims at is bigger than what they see. */
const HIT_R = 12;

interface PortDotProps {
    at: Point;
    zoom: number;
    /* 0 with the pointer still far off, 1 with it close enough to aim at the port. */
    strength: number;
    /* The pointer is on the port, which is what the accent says. */
    hot: boolean;
    /* Whether the ring is drawn at all: a line that already leaves here draws its own dot in that spot. */
    ring: boolean;
    /* How plain the ring is with the pointer nowhere near: a canvas offers a port only to a pointer
       that walks up to it, a worksheet shows every port its cards have. */
    rest: number;
    /* What a press finds the port by, since the gesture reads the DOM and not this component. */
    data: Record<string, string>;
}

/*
 * The dot a line is pulled out of, the same one on a canvas and on a worksheet. It keeps its size on
 * screen at every zoom: it is something to aim at, and what you aim at is on the screen and not in
 * the world.
 */
export function PortDot({ at, zoom, strength, hot, ring, rest, data }: PortDotProps) {
    return (
        <g style={{ opacity: rest + (1 - rest) * strength }}>
            {/* The press lands here and not on the ring, so a port stays a port even where a line ends on it. */}
            <circle {...data} cx={at.x} cy={at.y} r={HIT_R / zoom} fill="transparent" className="pointer-events-auto cursor-crosshair" />
            {ring && (
                <circle
                    cx={at.x}
                    cy={at.y}
                    r={(DOT_R + (DOT_R_NEAR - DOT_R) * strength) / zoom}
                    fill="var(--canvas-bg)"
                    stroke={hot ? 'var(--accent)' : 'var(--edge-line)'}
                    strokeWidth={2 / zoom}
                />
            )}
        </g>
    );
}
