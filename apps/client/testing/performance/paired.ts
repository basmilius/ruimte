export interface PerformanceCase {
    name: string;
    before(): unknown;
    after(): unknown;
}

export function measurePairs(cases: readonly PerformanceCase[]) {
    let checksum = 0;

    const batch = (run: () => unknown, iterations: number): number => {
        const started = performance.now();

        for (let index = 0; index < iterations; index++) {
            const result = run();
            checksum += typeof result === 'string' || Array.isArray(result) ? result.length : result === null ? 0 : 1;
        }

        return (performance.now() - started) / iterations;
    };

    const iterationsFor = (run: () => unknown): number => {
        let iterations = 1;

        while (batch(run, iterations) * iterations < 8 && iterations < 1_048_576) {
            iterations *= 2;
        }

        return iterations;
    };

    const distribution = (samples: number[]) => {
        const sorted = [...samples].sort((left, right) => left - right);

        return { medianMs: sorted[15]!, p95Ms: sorted[29]!, samplesMs: samples };
    };

    const results = [];

    for (const entry of cases) {
        if (JSON.stringify(entry.after()) !== JSON.stringify(entry.before())) {
            throw new Error(`Different results for ${entry.name}`);
        }

        const beforeIterations = iterationsFor(entry.before);
        const afterIterations = iterationsFor(entry.after);
        const original: number[] = [];
        const changed: number[] = [];

        for (let sample = 0; sample < 31; sample++) {
            if (sample % 2 === 0) {
                original.push(batch(entry.before, beforeIterations));
                changed.push(batch(entry.after, afterIterations));
            } else {
                changed.push(batch(entry.after, afterIterations));
                original.push(batch(entry.before, beforeIterations));
            }
        }

        const baseline = distribution(original);
        const candidate = distribution(changed);
        results.push({ name: entry.name, beforeIterations, afterIterations, baseline, candidate, speedup: baseline.medianMs / candidate.medianMs });
    }

    return { samples: 31, checksum, results };
}
