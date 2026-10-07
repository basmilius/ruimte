import { describe, expect, test } from 'bun:test';
import { BENCHMARK_MODELS } from './benchmark-models.ts';

describe('the benchmark table', () => {
    test('looks every measured effort up by an id of its own', () => {
        const ids = BENCHMARK_MODELS.flatMap((model) => model.efforts.flatMap((entry) => (entry.id === null ? [] : [entry.id])));
        expect(new Set(ids).size).toBe(ids.length);
    });
});
