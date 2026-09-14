/*
 * Whether a run of wheel samples from a page is a two-finger swipe back or forward. Pure: the
 * registry feeds it what the guest preload reports and acts on what comes out, so every threshold
 * is pinned in `swipe.test.ts` without a trackpad.
 */

/* One wheel event as the guest preload reports it (`apps/desktop/src/guest.ts`). */
export interface WheelSample {
    deltaX: number;
    deltaY: number;
    /* True once the fingers are off the trackpad and macOS is coasting. */
    momentum: boolean;
    /* The page called `preventDefault`, which is how a map says the gesture is its own. */
    handled: boolean;
    /* Ctrl was held, which is how Chromium reports a pinch: the page zooms and no swipe is involved. */
    pinch: boolean;
    /* Something under the pointer can still scroll this way, claims its overscroll, or is zoomed in and can still pan. */
    pageTakes: boolean;
}

export type SwipeSide = 'back' | 'forward';

export interface SwipeHistory {
    canGoBack: boolean;
    canGoForward: boolean;
}

export interface SwipeState {
    /* `held` is a gesture the page owns, ignored until it ends. */
    phase: 'idle' | 'tracking' | 'held';
    dx: number;
    dy: number;
    /* Whether the edge check already ran on this gesture's first horizontal sample. */
    checked: boolean;
    last: number;
    deafUntil: number;
}

export type SwipeOutcome = { kind: 'none' } | { kind: 'progress'; side: SwipeSide; progress: number } | { kind: 'navigate'; side: SwipeSide };

/*
 * Net horizontal travel that navigates, in the page's CSS pixels. The host is scaled by the camera
 * zoom on a canvas, and whether Chromium scales a guest's wheel deltas with that transform is not
 * measured: the reading of the source is that it moves the point and leaves the deltas alone, so
 * the travel is the finger's whatever the zoom. If it turns out otherwise, this is the one number
 * to divide by the zoom.
 */
export const SWIPE_THRESHOLD_PX = 150;
/* Horizontal has to outweigh vertical this many times over the gesture. */
export const SWIPE_DOMINANCE = 3;
/* macOS delivers scroll events at 60 Hz, so a longer silence is fingers that stopped or lifted. */
export const SWIPE_GESTURE_GAP_MS = 70;
/* After navigating, so the tail of the same gesture does not run into the next page. */
export const SWIPE_DEAF_MS = 500;

export const IDLE_SWIPE: SwipeState = { phase: 'idle', dx: 0, dy: 0, checked: false, last: 0, deafUntil: 0 };

const NONE: SwipeOutcome = { kind: 'none' };

const sideOf = (dx: number): SwipeSide => (dx < 0 ? 'back' : 'forward');

const allowed = (side: SwipeSide, history: SwipeHistory): boolean => (side === 'back' ? history.canGoBack : history.canGoForward);

/* What the gesture adds up to now, before anyone lifts a finger. */
const measure = (state: SwipeState, history: SwipeHistory): { side: SwipeSide; progress: number } | null => {
    if (state.phase !== 'tracking' || state.dx === 0 || Math.abs(state.dx) <= SWIPE_DOMINANCE * Math.abs(state.dy)) {
        return null;
    }
    const side = sideOf(state.dx);
    if (!allowed(side, history)) {
        return null;
    }
    return { side, progress: Math.min(1, Math.abs(state.dx) / SWIPE_THRESHOLD_PX) };
};

/* Ends the gesture: navigates when it got past the threshold, and goes deaf for a moment if it did. */
const finish = (state: SwipeState, history: SwipeHistory, now: number): { state: SwipeState; outcome: SwipeOutcome } => {
    const measured = measure(state, history);
    if (measured && measured.progress >= 1) {
        return { state: { ...IDLE_SWIPE, deafUntil: now + SWIPE_DEAF_MS }, outcome: { kind: 'navigate', side: measured.side } };
    }
    return { state: { ...IDLE_SWIPE, deafUntil: state.deafUntil }, outcome: NONE };
};

/*
 * The gesture after a silence, which is how it ends when no momentum follows (the fingers stopped
 * before they lifted). The registry calls it on a timer `SWIPE_GESTURE_GAP_MS` after the last sample.
 */
export const settleSwipe = (state: SwipeState, history: SwipeHistory, now: number): { state: SwipeState; outcome: SwipeOutcome } =>
    state.phase === 'idle' ? { state, outcome: NONE } : finish(state, history, now);

export const feedWheel = (state: SwipeState, sample: WheelSample, history: SwipeHistory, now: number): { state: SwipeState; outcome: SwipeOutcome } => {
    // A pinch neither adds to a swipe nor, when the page prevents it, holds the next one.
    if (sample.pinch) {
        return { state, outcome: NONE };
    }
    let current = state;
    let settled: SwipeOutcome = NONE;
    if (current.phase !== 'idle' && now - current.last > SWIPE_GESTURE_GAP_MS) {
        ({ state: current, outcome: settled } = finish(current, history, now));
    }
    // The first coasting sample is the fingers lifting; the rest of the tail never starts anything.
    if (sample.momentum) {
        if (current.phase === 'idle') {
            return { state: current, outcome: settled };
        }
        return finish(current, history, now);
    }
    if (settled.kind === 'navigate' || now < current.deafUntil) {
        return { state: current, outcome: settled };
    }
    if (current.phase === 'idle') {
        current = { ...current, phase: 'tracking', dx: 0, dy: 0, checked: false };
    }
    current = { ...current, last: now };
    if (current.phase === 'held') {
        return { state: current, outcome: NONE };
    }
    // A page that handles the wheel owns the whole gesture, and so does one that can still scroll
    // the way it starts: a carousel keeps the swipe until the gesture ends.
    const firstHorizontal = !current.checked && sample.deltaX !== 0;
    if (sample.handled || (firstHorizontal && sample.pageTakes)) {
        return { state: { ...current, phase: 'held' }, outcome: NONE };
    }
    current = { ...current, dx: current.dx + sample.deltaX, dy: current.dy + sample.deltaY, checked: current.checked || firstHorizontal };
    const measured = measure(current, history);
    return { state: current, outcome: measured ? { kind: 'progress', ...measured } : NONE };
};
