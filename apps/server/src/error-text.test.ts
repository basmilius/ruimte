import { describe, expect, test } from 'bun:test';
import { debugFrom } from './error-text.ts';

describe('debugFrom', () => {
    test('only 1 turns it on', () => {
        expect(debugFrom({ RUIMTE_DEBUG: '1' })).toBe(true);
        expect(debugFrom({ RUIMTE_DEBUG: '0' })).toBe(false);
        expect(debugFrom({})).toBe(false);
    });
});
