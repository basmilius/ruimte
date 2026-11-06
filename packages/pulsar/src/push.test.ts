import { describe, expect, test } from 'bun:test';
import { PUSH_APPROVAL_MAX_AGE_MS, PUSH_CIPHERTEXT_MAX_CHARS, PUSH_MAX_AGE_MS, PUSH_PLAINTEXT_MAX_BYTES, pushCiphertextChars } from './push.ts';

describe('the limits of one push', () => {
    test('an approval card expires before the push that carried it', () => {
        expect(PUSH_APPROVAL_MAX_AGE_MS).toBeLessThan(PUSH_MAX_AGE_MS);
        expect(PUSH_APPROVAL_MAX_AGE_MS).toBeGreaterThan(0);
    });

    test('the most plaintext an alert gets still encrypts to a ciphertext the envelope takes', () => {
        expect(pushCiphertextChars(PUSH_PLAINTEXT_MAX_BYTES)).toBeLessThanOrEqual(PUSH_CIPHERTEXT_MAX_CHARS);
    });

    test('counts the base64url characters of a ciphertext the way node writes them', () => {
        for (const bytes of [0, 1, 2, 3, 100, PUSH_PLAINTEXT_MAX_BYTES]) {
            expect(pushCiphertextChars(bytes)).toBe(Buffer.alloc(bytes + 16).toString('base64url').length);
        }
    });
});
