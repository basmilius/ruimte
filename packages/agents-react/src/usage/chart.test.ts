import { describe, expect, test } from 'bun:test';
import { niceScale } from './summary.ts';

describe('the y axis', () => {
    test('rounds up to a step a person reads at a glance', () => {
        expect(niceScale(28.12)).toEqual({ max: 30, step: 10 });
        expect(niceScale(1)).toEqual({ max: 1, step: 0.5 });
        expect(niceScale(1_240_000)).toEqual({ max: 1_500_000, step: 500_000 });
    });

    test('an empty period still has an axis', () => {
        expect(niceScale(0)).toEqual({ max: 1, step: 1 });
        expect(niceScale(Number.NaN)).toEqual({ max: 1, step: 1 });
    });
});
