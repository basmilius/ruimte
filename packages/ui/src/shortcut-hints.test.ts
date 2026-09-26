import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { HINT_DELAY_MS, ModifierHold, placeHint, type HoldKey } from './shortcut-hints.ts';

const press = (key: string, held: Partial<HoldKey> = {}): HoldKey => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...held
});

describe('ModifierHold', () => {
    let changes: boolean[];

    beforeEach(() => {
        jest.useFakeTimers();
        changes = [];
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('shows the hints once Cmd is held for the delay on macOS', () => {
        const hold = new ModifierHold(true, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS - 1);
        expect(changes).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(changes).toEqual([true]);
        hold.keyUp(press('Meta'));
        expect(changes).toEqual([true, false]);
    });

    test('uses Ctrl off macOS and ignores Cmd there', () => {
        const hold = new ModifierHold(false, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS);
        expect(changes).toEqual([]);
        hold.keyUp(press('Meta'));
        hold.keyDown(press('Control', { ctrlKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS);
        expect(changes).toEqual([true]);
    });

    test('a second key before the delay cancels, so a shortcut never flashes the hints', () => {
        const hold = new ModifierHold(true, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true }));
        jest.advanceTimersByTime(200);
        hold.keyDown(press('b', { metaKey: true }));
        // The modifier still down repeats, which must not start the wait again.
        hold.keyDown(press('Meta', { metaKey: true, repeat: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS * 2);
        expect(changes).toEqual([]);
    });

    test('a second key after the delay takes the hints down', () => {
        const hold = new ModifierHold(true, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS);
        hold.keyDown(press('k', { metaKey: true }));
        expect(changes).toEqual([true, false]);
    });

    test('the modifier pressed along with another modifier does not count', () => {
        const hold = new ModifierHold(true, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true, shiftKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS);
        expect(changes).toEqual([]);
    });

    test('cancel stops a pending wait and hides shown hints', () => {
        const hold = new ModifierHold(true, (shown) => changes.push(shown));
        hold.keyDown(press('Meta', { metaKey: true }));
        hold.cancel();
        jest.advanceTimersByTime(HINT_DELAY_MS);
        expect(changes).toEqual([]);
        hold.keyDown(press('Meta', { metaKey: true }));
        jest.advanceTimersByTime(HINT_DELAY_MS);
        hold.cancel();
        hold.cancel();
        expect(changes).toEqual([true, false]);
    });
});

describe('placeHint', () => {
    const viewport = { width: 1000, height: 800 };

    test('centers the hint under its button', () => {
        expect(placeHint({ left: 500, right: 528, top: 10, bottom: 38 }, viewport)).toEqual({ left: 514, top: 40, translateX: '-50%', translateY: '0' });
    });

    test('lines up with the window edge a button sits against', () => {
        expect(placeHint({ left: 8, right: 36, top: 10, bottom: 38 }, viewport)).toMatchObject({ left: 8, translateX: '0' });
        expect(placeHint({ left: 964, right: 992, top: 10, bottom: 38 }, viewport)).toMatchObject({ right: 8, translateX: '0' });
    });

    test('goes above a button at the bottom of the window', () => {
        expect(placeHint({ left: 500, right: 528, top: 770, bottom: 798 }, viewport)).toMatchObject({ top: 768, translateY: '-100%' });
    });
});
