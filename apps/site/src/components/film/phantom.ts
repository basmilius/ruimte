// The forms of the computer-use cursor, ported from `apps/computer-use/Sources/Phantom/PhantomForms.swift`,
// so the page draws the very outline the helper draws. Each form lives in a 24 × 24 box with the hotspot at (4, 3.5).

type Point = readonly [number, number];

const round = (value: number): number => Math.floor(value * 100 + 0.5) / 100;
const fmt = ([x, y]: Point): string => `${round(x)} ${round(y)}`;

function poly(corners: readonly Point[]): string {
    return `M ${fmt(corners[0])} ${corners
        .slice(1)
        .concat([corners[0]])
        .map((corner) => `L ${fmt(corner)}`)
        .join(' ')} Z`;
}

function tear(tip: Point, center: Point, radius: number): string {
    const phi = Math.atan2(tip[1] - center[1], tip[0] - center[0]);
    const opening = Math.acos(radius / Math.hypot(tip[0] - center[0], tip[1] - center[1]));
    const onCircle = (angle: number): Point => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    const first = phi + opening;
    const last = phi + 2 * Math.PI - opening;
    return `M ${fmt(tip)} L ${fmt(onCircle(first))} A ${radius} ${radius} 0 1 1 ${fmt(onCircle(last))} Z`;
}

export const PHANTOM_ARROW = poly([
    [4, 3.5],
    [20.5, 10.5],
    [13.5, 13.5],
    [10.5, 20.5]
]);

export const PHANTOM_DOT = tear([4, 3.5], [12.5, 12.5], 7);

export const PHANTOM_SMALL = tear([4, 3.5], [10.5, 10.5], 4.5);

/** Literal colors of the overlay in the dark theme (`OverlayStyle.palette(.dark)`). */
export const PHANTOM_COLORS = {
    accent: '#155dfc',
    needs: '#fbbf24',
    done: '#4ade80',
    muted: '#9a9aa6'
} as const;
