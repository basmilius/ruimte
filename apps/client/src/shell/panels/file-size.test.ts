import { describe, expect, test } from 'bun:test';
import { formatBytes } from './file-size.ts';

describe('formatBytes', () => {
    test('counts bytes whole and everything above them to one decimal', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
        expect(formatBytes(1024 ** 4)).toBe('1 TB');
    });

    test('a size that cannot be is still a size', () => {
        expect(formatBytes(-1)).toBe('0 B');
    });
});
