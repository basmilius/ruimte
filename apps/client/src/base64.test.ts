import { expect, test } from 'bun:test';
import { base64Of } from './base64';

test('encodes RFC 4648 padding and binary subarrays with both native and fallback encoders', () => {
    const vectors: Array<[number[], string]> = [
        [[], ''],
        [[102], 'Zg=='],
        [[102, 111], 'Zm8='],
        [[102, 111, 111], 'Zm9v'],
        [[0, 255, 128], 'AP+A']
    ];

    for (const [input, expected] of vectors) {
        const storage = new Uint8Array([42, ...input, 42]);
        const bytes = storage.subarray(1, storage.length - 1);
        expect(base64Of(bytes)).toBe(expected);
        Object.defineProperty(bytes, 'toBase64', { value: undefined });
        expect(base64Of(bytes)).toBe(expected);
    }
});
