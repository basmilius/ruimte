import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { dropPreview, HIDE_GRACE_MS, hideDropPreview, showDropPreview } from './drop-preview';
import { rectPreview } from './tab-drop';

const first = rectPreview({ x: 0, y: 0, width: 100, height: 100 });
const second = rectPreview({ x: 100, y: 0, width: 100, height: 100 });

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    hideDropPreview();
    jest.useRealTimers();
});

describe('the drop preview', () => {
    test('fades in at its first shape instead of moving there', () => {
        showDropPreview(first);
        expect(dropPreview()).toEqual({ shape: first, shown: true, morph: false });
    });

    test('moves from one shape to the next while it is shown', () => {
        showDropPreview(first);
        showDropPreview(second);
        expect(dropPreview()).toEqual({ shape: second, shown: true, morph: true });
    });

    test('keeps its shape while it fades out and does not move out of it into the next drag', () => {
        showDropPreview(first);
        hideDropPreview();
        expect(dropPreview()).toEqual({ shape: first, shown: false, morph: false });
        showDropPreview(second);
        expect(dropPreview()).toEqual({ shape: second, shown: true, morph: false });
    });

    test('says nothing for the shape it already has', () => {
        showDropPreview(first);
        const before = dropPreview();
        showDropPreview({ ...first });
        expect(dropPreview()).toBe(before);
    });

    test('waits out the grace for a pointer on its way to another cell, and glides there', () => {
        showDropPreview(first);
        hideDropPreview(true);
        jest.advanceTimersByTime(HIDE_GRACE_MS - 1);
        expect(dropPreview().shown).toBe(true);
        showDropPreview(second);
        jest.advanceTimersByTime(HIDE_GRACE_MS * 2);
        expect(dropPreview()).toEqual({ shape: second, shown: true, morph: true });
    });

    test('goes once the grace is over with no other cell', () => {
        showDropPreview(first);
        hideDropPreview(true);
        jest.advanceTimersByTime(HIDE_GRACE_MS);
        expect(dropPreview().shown).toBe(false);
    });

    test('goes at once for an ended drag, and a leave that was waiting does not bring it back', () => {
        showDropPreview(first);
        hideDropPreview(true);
        hideDropPreview();
        expect(dropPreview().shown).toBe(false);
        jest.advanceTimersByTime(HIDE_GRACE_MS * 2);
        expect(dropPreview().shown).toBe(false);
    });
});
