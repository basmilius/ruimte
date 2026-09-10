import { describe, expect, test } from 'bun:test';
import { cacheSavingsOf, costOf, lookupPrice, parsePriceTable } from './pricing.ts';

const entry = (input: number, output: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    litellm_provider: 'anthropic',
    mode: 'chat',
    input_cost_per_token: input,
    output_cost_per_token: output,
    ...extra
});

const table = parsePriceTable({
    'claude-opus-4-5': entry(0.000005, 0.000025, { cache_read_input_token_cost: 0.0000005, cache_creation_input_token_cost: 0.00000625 }),
    'anthropic/claude-fable-5-1': entry(0.000003, 0.000015),
    'gpt-5.6': { ...entry(0.000001, 0.000008), litellm_provider: 'openai', mode: 'responses' },
    'half-priced': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 0.000001 },
    'gemini-3-pro': { ...entry(0.000002, 0.000009), litellm_provider: 'vertex_ai' },
    'claude-opus-4-5-batches': entry(0.0000025, 0.0000125)
});

describe('the price table', () => {
    test('keeps the models the readers can meet and drops the rest', () => {
        expect(table.has('claude-opus-4-5')).toBe(true);
        expect(table.has('gpt-5.6')).toBe(true);
        expect(table.has('half-priced')).toBe(false);
        expect(table.has('gemini-3-pro')).toBe(false);
    });

    test('a name behind a provider prefix is reachable under its bare name too', () => {
        expect(table.get('claude-fable-5-1')).toEqual(table.get('anthropic/claude-fable-5-1')!);
    });

    test('fills in the cache rates the table leaves out', () => {
        const price = table.get('claude-fable-5-1')!;
        expect(price.cacheRead).toBeCloseTo(0.0000003, 12);
        expect(price.cacheWrite).toBeCloseTo(0.00000375, 12);
        expect(price.cacheWrite1h).toBeCloseTo(0.000006, 12);
    });
});

describe('looking a model up', () => {
    test('takes an exact name, then the same name without its date', () => {
        expect(lookupPrice(table, 'claude-opus-4-5')).toMatchObject({ basis: 'exact', pricedAs: null });
        expect(lookupPrice(table, 'claude-opus-4-5-20251101')).toMatchObject({ basis: 'exact', pricedAs: 'claude-opus-4-5' });
    });

    test('falls back to the longest family the table knows', () => {
        const found = lookupPrice(table, 'gpt-5.6-sol-preview');
        expect(found.basis).toBe('family');
        expect(found.pricedAs).toBe('gpt-5.6');
        expect(found.price).toEqual(table.get('gpt-5.6')!);
    });

    test('leaves a name nobody prices and a bare family name unpriced', () => {
        expect(lookupPrice(table, 'some-model-nobody-sells')).toMatchObject({ price: null, basis: 'unknown' });
        expect(lookupPrice(table, 'opus')).toMatchObject({ price: null, basis: 'unknown' });
        expect(lookupPrice(table, '')).toMatchObject({ price: null, basis: 'unknown' });
    });

    test('ignores a context window suffix', () => {
        expect(lookupPrice(table, 'claude-opus-4-5[1m]')).toMatchObject({ basis: 'exact', pricedAs: null });
    });
});

describe('what a call costs', () => {
    const price = table.get('claude-opus-4-5')!;
    const totals = { calls: 1, input: 1_000, cacheRead: 10_000, cacheWrite: 2_000, cacheWrite1h: 500, output: 400, reasoning: 100 };

    test('charges the one hour cache writes at their own rate and reasoning at none', () => {
        const expected = 1_000 * 0.000005 + 10_000 * 0.0000005 + 1_500 * 0.00000625 + 500 * 0.00001 + 400 * 0.000025;
        expect(costOf(totals, price)).toBeCloseTo(expected, 10);
        expect(costOf({ ...totals, reasoning: 0 }, price)).toBeCloseTo(expected, 10);
    });

    test('counts the saving of a cache read against sending the tokens again', () => {
        expect(cacheSavingsOf(totals, price)).toBeCloseTo(10_000 * (0.000005 - 0.0000005), 10);
    });
});
