import { describe, expect, test } from 'bun:test';
import { dayPartOf } from './welcome';

function at(hour: number, minute = 0): Date {
    return new Date(2026, 9, 1, hour, minute);
}

describe('the part of the day a greeting names', () => {
    test('follows the local clock, each part from its first minute', () => {
        expect(dayPartOf(at(0))).toBe('night');
        expect(dayPartOf(at(4, 59))).toBe('night');
        expect(dayPartOf(at(5))).toBe('morning');
        expect(dayPartOf(at(11, 59))).toBe('morning');
        expect(dayPartOf(at(12))).toBe('afternoon');
        expect(dayPartOf(at(17, 59))).toBe('afternoon');
        expect(dayPartOf(at(18))).toBe('evening');
        expect(dayPartOf(at(23, 59))).toBe('evening');
    });
});
