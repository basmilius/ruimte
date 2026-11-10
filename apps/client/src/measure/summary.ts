interface Distribution {
    n: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

/* Nearest rank, as the latency script reports, rounded to a tenth of the unit. */
export function distribution(samples: readonly number[]): Distribution {
    if (samples.length === 0) {
        return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const at = (fraction: number): number => {
        const rank = Math.ceil(fraction * sorted.length) - 1;
        return round(sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!);
    };
    return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: round(sorted.at(-1)!) };
}

export function round(value: number): number {
    return Math.round(value * 10) / 10;
}

interface FrameSummary extends Distribution {
    /* Frames longer than one, two and three 60 Hz frames, the steps a person notices. */
    over17: number;
    over33: number;
    over50: number;
}

export function frameSummary(deltas: readonly number[]): FrameSummary {
    return {
        ...distribution(deltas),
        over17: deltas.filter((delta) => delta > 1000 / 60 + 1).length,
        over33: deltas.filter((delta) => delta > 2000 / 60 + 1).length,
        over50: deltas.filter((delta) => delta > 50).length
    };
}

export interface HeapSample {
    usedBytes: number;
    totalBytes: number;
    limitBytes: number;
}

interface HeapSummary {
    /* Megabytes (2^20 bytes). */
    usedMb: { first: number; min: number; max: number; last: number };
    totalMb: number;
    limitMb: number;
    samples: number;
}

const MB = 1024 * 1024;

/* Null where the engine reports no heap (only Chromium has `performance.memory`). */
export function heapSummary(samples: readonly HeapSample[]): HeapSummary | null {
    if (samples.length === 0) {
        return null;
    }
    const used = samples.map((sample) => sample.usedBytes / MB);
    const last = samples.at(-1)!;
    return {
        usedMb: { first: round(used[0]!), min: round(Math.min(...used)), max: round(Math.max(...used)), last: round(used.at(-1)!) },
        totalMb: round(last.totalBytes / MB),
        limitMb: round(last.limitBytes / MB),
        samples: samples.length
    };
}

export function byType(samples: readonly { type: string; ms: number }[]): Record<string, Distribution> {
    const grouped = new Map<string, number[]>();
    for (const sample of samples) {
        const list = grouped.get(sample.type) ?? [];
        list.push(sample.ms);
        grouped.set(sample.type, list);
    }
    return Object.fromEntries([...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([type, list]) => [type, distribution(list)]));
}
