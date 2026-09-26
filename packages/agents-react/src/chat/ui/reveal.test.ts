import { describe, expect, test } from 'bun:test';
import { REVEAL_MAX_FRAME_MS, REVEAL_MAX_HELD_WORD, REVEAL_MIN_CPS, REVEAL_TAU_MS, advanceReveal, revealBoundary } from './reveal';

describe('advanceReveal', () => {
    test('does not depend on the frame rate', () => {
        const twoFrames = advanceReveal(advanceReveal(0, 1000, 8, false), 1000, 8, false);
        const oneFrame = advanceReveal(0, 1000, 16, false);
        expect(twoFrames).toBeCloseTo(oneFrame, 6);
    });

    test('closes about two thirds of the gap in one time constant', () => {
        let position = 0;
        for (let elapsed = 0; elapsed < REVEAL_TAU_MS; elapsed += 10) {
            position = advanceReveal(position, 1000, 10, false);
        }
        expect(position).toBeCloseTo(1000 * (1 - Math.exp(-1)), 0);
    });

    test('keeps a minimum speed on a small gap', () => {
        expect(advanceReveal(0, 5, 50, false)).toBeCloseTo((REVEAL_MIN_CPS * 50) / 1000, 6);
    });

    test('closes the tail faster once the item is done', () => {
        expect(advanceReveal(0, 5, 20, true)).toBeGreaterThan(advanceReveal(0, 5, 20, false));
    });

    test('bounds a long frame', () => {
        expect(advanceReveal(0, 1000, 60_000, false)).toBeCloseTo(advanceReveal(0, 1000, REVEAL_MAX_FRAME_MS, false), 6);
        expect(advanceReveal(0, 1000, 60_000, false)).toBeLessThan(1000);
    });

    test('never passes the target or runs backwards', () => {
        expect(advanceReveal(3, 3, 16, false)).toBe(3);
        expect(advanceReveal(10, 3, 16, false)).toBe(3);
        expect(advanceReveal(1, 3, -16, false)).toBe(1);
    });
});

describe('revealBoundary', () => {
    test('stops before a word the position is in the middle of', () => {
        expect(revealBoundary('hello world again', 8, false)).toBe(6);
        expect(revealBoundary('hello world again', 5, false)).toBe(5);
    });

    test('holds the last word of a text that is still arriving', () => {
        expect(revealBoundary('hello wor', 9, false)).toBe(6);
        expect(revealBoundary('hello world ', 12, false)).toBe(12);
    });

    test('shows the last word once the text is done', () => {
        expect(revealBoundary('hello world', 11, true)).toBe(11);
        expect(revealBoundary('hello world', 10, true)).toBe(6);
    });

    test('lets a very long word through without splitting a surrogate pair', () => {
        const word = 'a'.repeat(REVEAL_MAX_HELD_WORD + 5);
        expect(revealBoundary(word, REVEAL_MAX_HELD_WORD + 3, false)).toBe(REVEAL_MAX_HELD_WORD + 3);
        const emoji = 'a'.repeat(REVEAL_MAX_HELD_WORD + 1) + '\u{1F600}bbb';
        expect(revealBoundary(emoji, REVEAL_MAX_HELD_WORD + 2, false)).toBe(REVEAL_MAX_HELD_WORD + 1);
    });
});
