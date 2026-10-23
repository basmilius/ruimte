import { describe, expect, test } from 'bun:test';
import { BenchmarkLabSchema } from '@ruimte/pulsar';
import { BENCHMARK_LABS, BENCHMARK_MODELS } from './benchmark-models.ts';

describe('the benchmark table', () => {
    test('looks every measured effort up by an id of its own', () => {
        const ids = BENCHMARK_MODELS.flatMap((model) => model.efforts.flatMap((entry) => (entry.id === null ? [] : [entry.id])));
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('gives every model a lab that a client accepts', () => {
        const labs = new Set(BENCHMARK_LABS.map((lab) => lab.id));
        expect(labs.size).toBe(BENCHMARK_LABS.length);
        expect(BENCHMARK_MODELS.filter((model) => !labs.has(model.provider))).toEqual([]);
        for (const lab of BENCHMARK_LABS) {
            expect(BenchmarkLabSchema.safeParse(lab).success).toBe(true);
        }
    });
});
