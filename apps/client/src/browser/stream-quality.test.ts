import { describe, expect, test } from 'bun:test';
import { browserStreamScaleOptions, clampBrowserStreamScale } from './stream-quality';

describe('browser stream quality', () => {
    test('offers half-step scales through the client display scale', () => {
        expect(browserStreamScaleOptions(2)).toEqual([1, 1.5, 2]);
        expect(browserStreamScaleOptions(1.75)).toEqual([1, 1.5, 1.75]);
        expect(browserStreamScaleOptions(1.25)).toEqual([1, 1.25]);
    });

    test('keeps the selected scale within the display and transport limits', () => {
        expect(clampBrowserStreamScale(2, 1.5)).toBe(1.5);
        expect(browserStreamScaleOptions(3)).toEqual([1, 1.5, 2]);
        expect(browserStreamScaleOptions(Number.NaN)).toEqual([1]);
    });
});
