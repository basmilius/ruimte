import { describe, expect, test } from 'bun:test';
import { isDeclined, isScheduled } from './routine-approval.ts';

describe('a routine a person said no to', () => {
    test('is declined only as it stands now', () => {
        expect(isDeclined({ local: { declined: 'abc' }, digest: 'abc' })).toBe(true);
        expect(isDeclined({ local: { declined: 'abc' }, digest: 'def' })).toBe(false);
        expect(isDeclined({ local: {}, digest: 'abc' })).toBe(false);
    });

    test('is not scheduled, though an earlier approval still stands', () => {
        expect(isScheduled({ approved: true, local: {}, digest: 'abc' })).toBe(true);
        expect(isScheduled({ approved: true, local: { declined: 'abc' }, digest: 'abc' })).toBe(false);
        expect(isScheduled({ approved: true, local: { declined: 'old' }, digest: 'abc' })).toBe(true);
        expect(isScheduled({ approved: false, local: {}, digest: 'abc' })).toBe(false);
    });
});
