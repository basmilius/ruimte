import { describe, expect, test } from 'bun:test';
import { PERSON_HOLD_CODES, personHoldOfCode } from './person-hold.ts';

describe('person hold', () => {
    test('reads back the code of each hold and no other', () => {
        for (const [hold, code] of Object.entries(PERSON_HOLD_CODES)) {
            expect(personHoldOfCode(code)).toBe(hold as 'paused' | 'takenOver');
        }

        expect(personHoldOfCode('stopped')).toBeNull();
        expect(personHoldOfCode(undefined)).toBeNull();
    });
});
