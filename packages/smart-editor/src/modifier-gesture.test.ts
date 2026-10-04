import { describe, expect, test } from 'bun:test';
import { DoubleModifierGesture, type GestureEvent } from './modifier-gesture.ts';

function event(key: string, timeStamp: number, down: Partial<GestureEvent> = {}): GestureEvent {
    return { key, timeStamp, altKey: key === 'Alt', ctrlKey: false, metaKey: false, shiftKey: false, ...down };
}

/* Taps Option twice and holds it, the second press at `gap` milliseconds after the first one went up. */
function arm(gesture: DoubleModifierGesture, gap = 100): void {
    gesture.keydown(event('Alt', 0));
    gesture.keyup(event('Alt', 80, { altKey: false }));
    gesture.keydown(event('Alt', 80 + gap));
}

describe('the double modifier gesture', () => {
    test('adds a caret on the arrow after two taps with the modifier still down', () => {
        const gesture = new DoubleModifierGesture('Alt');
        arm(gesture);
        expect(gesture.keydown(event('ArrowUp', 300, { altKey: true }))).toBe('above');
        expect(gesture.keydown(event('ArrowDown', 400, { altKey: true }))).toBe('below');
    });

    test('does nothing for an arrow after one tap, or when the taps are too far apart', () => {
        const once = new DoubleModifierGesture('Alt');
        once.keydown(event('Alt', 0));
        expect(once.keydown(event('ArrowUp', 100, { altKey: true }))).toBeNull();
        const slow = new DoubleModifierGesture('Alt');
        arm(slow, 400);
        expect(slow.keydown(event('ArrowUp', 700, { altKey: true }))).toBeNull();
    });

    test('is spoiled by another key in between, and by another modifier held with it', () => {
        const typed = new DoubleModifierGesture('Alt');
        typed.keydown(event('Alt', 0));
        typed.keydown(event('a', 40, { altKey: true }));
        typed.keyup(event('Alt', 80, { altKey: false }));
        typed.keydown(event('Alt', 150));
        expect(typed.keydown(event('ArrowUp', 200, { altKey: true }))).toBeNull();
        const shifted = new DoubleModifierGesture('Alt');
        arm(shifted);
        expect(shifted.keydown(event('ArrowUp', 300, { altKey: true, shiftKey: true }))).toBeNull();
    });

    test('ignores the repeats of a held modifier and ends when the modifier goes up', () => {
        const gesture = new DoubleModifierGesture('Alt');
        arm(gesture);
        gesture.keydown(event('Alt', 200, { repeat: true }));
        expect(gesture.keydown(event('ArrowUp', 250, { altKey: true }))).toBe('above');
        gesture.keyup(event('Alt', 300, { altKey: false }));
        expect(gesture.keydown(event('ArrowUp', 350))).toBeNull();
    });

    test('is Ctrl for the platforms that are not macOS', () => {
        const gesture = new DoubleModifierGesture('Control');
        gesture.keydown(event('Control', 0, { ctrlKey: true }));
        gesture.keyup(event('Control', 80));
        gesture.keydown(event('Control', 150, { ctrlKey: true }));
        expect(gesture.keydown(event('ArrowDown', 250, { ctrlKey: true }))).toBe('below');
    });
});
