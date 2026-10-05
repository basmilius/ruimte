/*
 * How a scroll that moves the view a distance goes there: not at all for a line or less, and for more
 * over a moment that grows with the distance up to a tenth of a second, starting fast and easing out.
 */

/* The longest the view takes to get anywhere. */
export const SCROLL_DURATION_MS = 100;

/* How many lines away the view has to go before it takes any time, and how many before it takes all of it. */
const FREE_LINES = 1;
const FULL_LINES = 11;

export function scrollDuration(distance: number, lineHeight: number): number {
    const lines = distance / lineHeight;
    const part = Math.min(1, Math.max(0, (lines - FREE_LINES) / (FULL_LINES - FREE_LINES)));
    return Math.round(part * SCROLL_DURATION_MS);
}

/* The curve `cubic-bezier(0, 0, 0.58, 1)`: how much of the way has been gone after a fraction of the time. */
export function easeOut(fraction: number): number {
    if (fraction <= 0) {
        return 0;
    }
    if (fraction >= 1) {
        return 1;
    }
    const x1 = 0;
    const y1 = 0;
    const x2 = 0.58;
    const y2 = 1;
    const bezier = (t: number, a: number, b: number): number => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    let low = 0;
    let high = 1;
    let t = fraction;
    for (let step = 0; step < 24; step++) {
        const x = bezier(t, x1, x2);
        if (Math.abs(x - fraction) < 1e-5) {
            break;
        }
        if (x < fraction) {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) / 2;
    }
    return bezier(t, y1, y2);
}
