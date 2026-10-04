/*
 * The pure part of sliding a panel tree's rows sideways to read a long name. The rows stay as wide
 * as the panel; what moves is where their content starts, so the ellipsis keeps the panel's edge.
 */

/* The custom property the tree's stylesheet reads the shift from; it reaches into the shadow root. */
export const SHIFT_PROPERTY = '--panel-tree-shift';

/* What a wheel step in lines is worth sideways; a step in pages is the panel's width. */
const LINE_WIDTH = 16;

/* Below this a thumb is too small to find on a long name. */
const MIN_THUMB = 24;

export function clampShift(value: number, max: number): number {
    return Math.min(Math.max(value, 0), Math.max(max, 0));
}

/*
 * How far a row's content has to move for its name to end at its limit, from where the name ends
 * now and the shift it was measured at. The limit is the first thing pinned after the name, which
 * the shift leaves where it is.
 */
export function shiftNeed(textRight: number, limit: number, shift: number): number {
    return Math.max(0, Math.ceil(textRight + shift - limit));
}

/* What the widest row asks for; the rows a tree does not draw ask nothing. */
export function maxShift(needs: readonly number[]): number {
    return needs.reduce((max, need) => Math.max(max, need), 0);
}

export interface WheelStep {
    readonly deltaX: number;
    readonly deltaY: number;
    readonly deltaMode: number;
    readonly shiftKey: boolean;
}

/*
 * The sideways part of a wheel step, or 0 when the step is mostly up or down: a vertical scroll
 * with a little drift in it must not slide the rows. A wheel without a horizontal axis scrolls
 * sideways with Shift held.
 */
export function sidewaysDelta(step: WheelStep, pageWidth: number): number {
    const swapped = step.shiftKey && step.deltaX === 0;
    const sideways = swapped ? step.deltaY : step.deltaX;
    const across = swapped ? 0 : step.deltaY;
    if (sideways === 0 || Math.abs(sideways) <= Math.abs(across)) {
        return 0;
    }
    if (step.deltaMode === 1) {
        return sideways * LINE_WIDTH;
    }
    if (step.deltaMode === 2) {
        return sideways * pageWidth;
    }
    return sideways;
}

/* Where the indicator's thumb sits on its track, in whole pixels; `view` is what a row shows of itself. */
export function shiftThumb(shift: number, max: number, track: number, view: number): { left: number; width: number } {
    if (max <= 0 || track <= 0) {
        return { left: 0, width: Math.max(track, 0) };
    }
    const width = Math.min(track, Math.max(MIN_THUMB, Math.round((track * view) / (view + max))));
    return { left: Math.round(((track - width) * clampShift(shift, max)) / max), width };
}
