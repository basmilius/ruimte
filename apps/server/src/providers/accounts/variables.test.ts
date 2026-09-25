import { describe, expect, test } from 'bun:test';
import { keychainService } from './variables.ts';

describe('the keychain service of a machine', () => {
    test('is its own per home, and the same for one home however it is written', () => {
        expect(keychainService('/Users/bas/.ruimte')).not.toBe(keychainService('/Users/bas/.ruimte-dev'));
        expect(keychainService('/Users/bas/.ruimte')).toBe(keychainService('/Users/bas/./.ruimte/'));
        expect(keychainService('/Users/bas/.ruimte')).toMatch(/^ruimte-provider-env-[0-9a-f]{12}$/);
    });
});
