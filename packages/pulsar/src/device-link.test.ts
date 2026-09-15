import { describe, expect, test } from 'bun:test';
import { USER_CODE_ALPHABET, UserCodeSchema, formatUserCode, generateUserCode, keyFingerprint, normalizeUserCode } from './index.ts';

describe('user codes', () => {
    test('a code is eight letters of the alphabet, printed in two groups of four', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateUserCode();
            expect(UserCodeSchema.safeParse(code).success).toBe(true);
            expect(formatUserCode(code)).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
        }
    });

    test('the alphabet has no vowels, no digits and no letter twice', () => {
        expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY0-9]/);
        expect(new Set(USER_CODE_ALPHABET).size).toBe(USER_CODE_ALPHABET.length);
    });

    test('bytes past the last whole multiple of the alphabet are drawn again', () => {
        const draws = [new Uint8Array(16).fill(250), Uint8Array.from({ length: 16 }, (_value, i) => i)];
        const code = generateUserCode((count) => draws.shift() ?? new Uint8Array(count));
        expect(code).toBe(USER_CODE_ALPHABET.slice(0, 8));
    });

    test('what a person typed reads as the code whatever the case, spaces and dashes', () => {
        expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDFGHJK');
        expect(normalizeUserCode(' BCDF GHJK ')).toBe('BCDFGHJK');
        expect(normalizeUserCode('BCDF-GHJ')).toBeNull();
        expect(normalizeUserCode('ABCD-EFGH')).toBeNull();
        expect(normalizeUserCode('BCDF-GHJK-L')).toBeNull();
    });
});

describe('key fingerprints', () => {
    test('the first eight bytes in hex, in groups of four', () => {
        const key = Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i * 17)).toString('base64url');
        expect(keyFingerprint(key)).toBe('0011 2233 4455 6677');
    });
});
