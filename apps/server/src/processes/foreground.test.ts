import { describe, expect, test } from 'bun:test';
import { foregroundGroup, holdsForeground } from './foreground.ts';

function printed(output: string | null) {
    return async (): Promise<string | null> => output;
}

describe('holdsForeground', () => {
    test('the shell holds the foreground only when the group in front is its own', async () => {
        expect(await holdsForeground(4211, printed('  4211\n'))).toBe(true);
        expect(await holdsForeground(4211, printed('  5120\n'))).toBe(false);
    });

    test('says nothing for a process without a terminal, output it cannot read or a ps that failed', async () => {
        expect(await holdsForeground(4211, printed('   -1\n'))).toBeNull();
        expect(await holdsForeground(4211, printed('0'))).toBeNull();
        expect(await holdsForeground(4211, printed(''))).toBeNull();
        expect(await holdsForeground(4211, printed(null))).toBeNull();
    });
});

describe('foregroundGroup', () => {
    test('is the group in front, whichever process asked', async () => {
        expect(await foregroundGroup(4211, printed('  5120\n'))).toBe(5120);
        expect(await foregroundGroup(4211, printed('   -1\n'))).toBeNull();
    });
});
