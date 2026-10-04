import { describe, expect, test } from 'bun:test';
import { placeBeside, placePopup } from './popup-placement';

const window = { width: 1000, height: 800 };
const anchor = (left: number, top: number) => ({ left, top, right: left + 8, bottom: top + 20 });

describe('placePopup', () => {
    test('goes under the character, aligned with its left edge', () => {
        expect(placePopup(anchor(100, 100), { width: 300, height: 120 }, window)).toMatchObject({ left: 100, top: 124, side: 'below' });
    });

    test('goes over the character when there is no room below', () => {
        expect(placePopup(anchor(100, 700), { width: 300, height: 120 }, window)).toMatchObject({ top: 700 - 4 - 120, side: 'above' });
    });

    test('is pushed back into the window at its right edge', () => {
        expect(placePopup(anchor(900, 100), { width: 300, height: 120 }, window).left).toBe(1000 - 300 - 8);
    });

    test('takes the side with more room and shortens to it when neither fits', () => {
        const placement = placePopup(anchor(100, 500), { width: 300, height: 600 }, window);
        expect(placement.side).toBe('above');
        expect(placement.maxHeight).toBe(500 - 4 - 8);
        expect(placement.top).toBe(500 - 4 - placement.maxHeight);
    });

    test('goes over when that is preferred and fits', () => {
        expect(placePopup(anchor(100, 400), { width: 300, height: 120 }, window, { prefer: 'above' }).side).toBe('above');
        expect(placePopup(anchor(100, 50), { width: 300, height: 120 }, window, { prefer: 'above' }).side).toBe('below');
    });
});

describe('placeBeside', () => {
    test('goes right of the first box, then left, then under it', () => {
        const first = { left: 100, top: 100, width: 300, height: 200 };
        expect(placeBeside(first, { width: 280, height: 150 }, window)).toMatchObject({ left: 404, top: 100 });
        expect(placeBeside({ ...first, left: 700 }, { width: 280, height: 150 }, window).left).toBe(700 - 4 - 280);
        expect(placeBeside({ ...first, left: 350 }, { width: 400, height: 150 }, window)).toMatchObject({ left: 350, top: 304 });
    });
});
