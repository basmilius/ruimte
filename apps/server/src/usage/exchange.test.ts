import { describe, expect, test } from 'bun:test';
import { parseRate } from './exchange.ts';

describe('the answer of the rate service', () => {
    test('reads the rate and the day it is of', () => {
        expect(parseRate({ amount: 1, base: 'USD', date: '2026-09-10', rates: { EUR: 0.8571 } }, 'EUR')).toEqual({
            currency: 'EUR',
            rate: 0.8571,
            date: '2026-09-10'
        });
    });

    test('refuses an answer that carries no rate for the currency asked for', () => {
        expect(parseRate({ date: '2026-09-10', rates: { GBP: 0.74 } }, 'EUR')).toBeNull();
        expect(parseRate({ date: '2026-09-10' }, 'EUR')).toBeNull();
    });

    test('refuses a rate that could not divide an amount', () => {
        expect(parseRate({ date: '2026-09-10', rates: { EUR: 0 } }, 'EUR')).toBeNull();
        expect(parseRate({ date: '2026-09-10', rates: { EUR: '0.85' } }, 'EUR')).toBeNull();
    });

    test('refuses an answer without a day, which is what makes a stored rate readable later', () => {
        expect(parseRate({ rates: { EUR: 0.86 } }, 'EUR')).toBeNull();
        expect(parseRate(null, 'EUR')).toBeNull();
    });
});
