import { describe, expect, test } from 'bun:test';
import { pngOf } from './devices/device-test-helpers.ts';
import { pngSize } from './shots.ts';

describe('pngSize', () => {
    test('reads the size from the header chunk of a png', () => {
        expect(pngSize(pngOf(1206, 2622))).toEqual({ width: 1206, height: 2622 });
    });

    test('answers null for anything that is not a png', () => {
        expect(pngSize(new Uint8Array(40))).toBeNull();
        expect(pngSize(pngOf(1, 1).subarray(0, 20))).toBeNull();
        expect(pngSize(new TextEncoder().encode('\u0089PNG\r\n\u001a\n    JUNK00000000'))).toBeNull();
    });
});
