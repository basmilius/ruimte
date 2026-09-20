import { describe, expect, test } from 'bun:test';
import {
    feedWheel,
    IDLE_SWIPE,
    settleSwipe,
    SWIPE_DEAF_MS,
    SWIPE_GESTURE_GAP_MS,
    type SwipeHistory,
    type SwipeOutcome,
    type SwipeState,
    type WheelSample
} from './swipe.ts';

const BOTH: SwipeHistory = { canGoBack: true, canGoForward: true };

const sample = (deltaX: number, deltaY = 0, extra: Partial<WheelSample> = {}): WheelSample => ({
    deltaX,
    deltaY,
    momentum: false,
    handled: false,
    pinch: false,
    pageTakes: false,
    ...extra
});

/* Feeds samples 16 ms apart, the way macOS delivers them, and keeps every outcome. */
const run = (
    samples: WheelSample[],
    history = BOTH,
    start: SwipeState = IDLE_SWIPE,
    from = 1000
): { state: SwipeState; outcomes: SwipeOutcome[]; at: number } => {
    let state = start;
    const outcomes: SwipeOutcome[] = [];
    let at = from;
    for (const next of samples) {
        const result = feedWheel(state, next, history, at);
        state = result.state;
        outcomes.push(result.outcome);
        at += 16;
    }
    return { state, outcomes, at };
};

const navigations = (outcomes: SwipeOutcome[]): SwipeOutcome[] => outcomes.filter((outcome) => outcome.kind === 'navigate');

describe('feedWheel', () => {
    test('a swipe past the threshold navigates back when the fingers lift', () => {
        const finger = Array.from({ length: 10 }, () => sample(-20, 1));
        const { outcomes } = run([...finger, sample(-15, 0, { momentum: true }), sample(-10, 0, { momentum: true })]);
        expect(outcomes[0]).toEqual({ kind: 'progress', side: 'back', progress: 20 / 150 });
        expect(outcomes[9]).toEqual({ kind: 'progress', side: 'back', progress: 1 });
        expect(navigations(outcomes)).toEqual([{ kind: 'navigate', side: 'back' }]);
        expect(outcomes[10]).toEqual({ kind: 'navigate', side: 'back' });
    });

    test('a swipe to the other side navigates forward', () => {
        const { outcomes } = run([...Array.from({ length: 8 }, () => sample(25)), sample(5, 0, { momentum: true })]);
        expect(navigations(outcomes)).toEqual([{ kind: 'navigate', side: 'forward' }]);
    });

    test('a gesture that stops without momentum settles after the gap', () => {
        const { state, at } = run(Array.from({ length: 10 }, () => sample(-20)));
        expect(settleSwipe(state, BOTH, at + SWIPE_GESTURE_GAP_MS).outcome).toEqual({ kind: 'navigate', side: 'back' });
    });

    test('a vertical scroll never shows or navigates anything', () => {
        const { outcomes, state, at } = run(Array.from({ length: 30 }, (_, i) => sample(i % 3 === 0 ? -6 : 0, 40)));
        expect(outcomes.every((outcome) => outcome.kind === 'none')).toBe(true);
        expect(settleSwipe(state, BOTH, at + SWIPE_GESTURE_GAP_MS).outcome).toEqual({ kind: 'none' });
    });

    test('a carousel that can still scroll keeps the whole gesture', () => {
        const { outcomes, state, at } = run([sample(-20, 0, { pageTakes: true }), ...Array.from({ length: 12 }, () => sample(-20))]);
        expect(outcomes.every((outcome) => outcome.kind === 'none')).toBe(true);
        expect(settleSwipe(state, BOTH, at + SWIPE_GESTURE_GAP_MS).outcome).toEqual({ kind: 'none' });
    });

    test('the edge check runs on the first horizontal sample only', () => {
        // The carousel reached its end halfway through the gesture, which was already the swipe's.
        const { outcomes } = run([
            sample(-20),
            sample(-20, 0, { pageTakes: true }),
            ...Array.from({ length: 8 }, () => sample(-20)),
            sample(0, 0, { momentum: true })
        ]);
        expect(navigations(outcomes)).toHaveLength(1);
    });

    test('a page that prevents the wheel stops the gesture', () => {
        const { outcomes } = run([sample(-40), sample(-40), sample(-40, 0, { handled: true }), sample(-40), sample(-40), sample(0, 0, { momentum: true })]);
        expect(outcomes.slice(2).every((outcome) => outcome.kind === 'none')).toBe(true);
    });

    test('a momentum tail on its own never starts a swipe', () => {
        const { outcomes } = run(Array.from({ length: 20 }, () => sample(-30, 0, { momentum: true })));
        expect(outcomes.every((outcome) => outcome.kind === 'none')).toBe(true);
    });

    test('a swipe that turns back below the threshold does not navigate', () => {
        const out = Array.from({ length: 9 }, () => sample(-20));
        const back = Array.from({ length: 5 }, () => sample(20));
        const { outcomes } = run([...out, ...back, sample(10, 0, { momentum: true })]);
        expect(outcomes[8]).toEqual({ kind: 'progress', side: 'back', progress: 1 });
        expect(outcomes[13]).toEqual({ kind: 'progress', side: 'back', progress: 80 / 150 });
        expect(navigations(outcomes)).toEqual([]);
    });

    test('without history nothing shows and nothing navigates', () => {
        const { outcomes } = run([...Array.from({ length: 10 }, () => sample(-20)), sample(0, 0, { momentum: true })], {
            canGoBack: false,
            canGoForward: true
        });
        expect(outcomes.every((outcome) => outcome.kind === 'none')).toBe(true);
    });

    test('is deaf for a moment after navigating', () => {
        const swipe = [...Array.from({ length: 10 }, () => sample(-20)), sample(0, 0, { momentum: true })];
        const first = run(swipe);
        const soon = run(swipe, BOTH, first.state, first.at + SWIPE_GESTURE_GAP_MS + 10);
        expect(navigations(soon.outcomes)).toEqual([]);
        const later = run(swipe, BOTH, soon.state, first.at + SWIPE_DEAF_MS + 100);
        expect(navigations(later.outcomes)).toHaveLength(1);
    });

    test('a pinch never shows or navigates anything', () => {
        const pinch = Array.from({ length: 20 }, (_, i) => sample(i % 2 === 0 ? -30 : 0, -8, { pinch: true }));
        const { outcomes, state, at } = run([...pinch, sample(0, 0, { momentum: true })]);
        expect(outcomes.every((outcome) => outcome.kind === 'none')).toBe(true);
        expect(settleSwipe(state, BOTH, at + SWIPE_GESTURE_GAP_MS).outcome).toEqual({ kind: 'none' });
    });

    test('a pinch inside a swipe leaves its travel alone', () => {
        const half = Array.from({ length: 5 }, () => sample(-20));
        const pinch = Array.from({ length: 3 }, () => sample(0, 400, { pinch: true }));
        const { outcomes } = run([...half, ...pinch, ...half, sample(0, 0, { momentum: true })]);
        expect(navigations(outcomes)).toEqual([{ kind: 'navigate', side: 'back' }]);
    });

    test('a pinch the page prevents does not hold the swipe after it', () => {
        const pinch = Array.from({ length: 3 }, () => sample(0, 10, { pinch: true, handled: true }));
        const { outcomes } = run([...pinch, ...Array.from({ length: 10 }, () => sample(-20)), sample(0, 0, { momentum: true })]);
        expect(navigations(outcomes)).toHaveLength(1);
    });

    test('a pause longer than the gap starts a new gesture', () => {
        const { state, at } = run(Array.from({ length: 5 }, () => sample(-20)));
        const result = feedWheel(state, sample(-20), BOTH, at + SWIPE_GESTURE_GAP_MS + 30);
        expect(result.outcome).toEqual({ kind: 'progress', side: 'back', progress: 20 / 150 });
    });
});
