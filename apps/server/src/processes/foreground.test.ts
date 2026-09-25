import { describe, expect, test } from 'bun:test';
import { foregroundOf } from './foreground.ts';

describe('foregroundOf', () => {
    test('the shell holds the foreground only when the group in front is its own', () => {
        expect(foregroundOf('  4211\n', 4211)).toBe(true);
        expect(foregroundOf('  5120\n', 4211)).toBe(false);
    });

    test('says nothing for a process without a terminal or output it cannot read', () => {
        expect(foregroundOf('   -1\n', 4211)).toBeNull();
        expect(foregroundOf('0', 4211)).toBeNull();
        expect(foregroundOf('', 4211)).toBeNull();
    });
});
