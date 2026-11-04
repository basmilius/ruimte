import { describe, expect, test } from 'bun:test';
import { percentiles, renderReport, type Environment, type PhaseData, type Run } from './latency-report.ts';

function phase(patch: Partial<PhaseData> = {}): PhaseData {
    return {
        seconds: 10,
        reply: [1, 2, 3],
        quiet: [4, 5],
        chat: [6],
        lag: [0.5],
        busyBytes: 10 * 1024 * 1024,
        busyFrames: 500,
        resyncs: 2,
        pauses: 3,
        ...patch
    };
}

const env: Environment = {
    date: '2026-10-11',
    commit: 'abc1234',
    dirty: true,
    bun: '1.4.2',
    version: '0.0.0',
    build: null,
    protocol: 1,
    agents: '0.21.2',
    cpu: 'Apple M4',
    cores: 10,
    memoryGiB: 32,
    os: 'Darwin 27.2.0',
    model: 'Mac16,1',
    power: "Now drawing from 'AC Power'"
};

const run: Run = {
    fixture: {
        busyCommand: 'yes x',
        replyIntervalMs: 50,
        quietIntervalMs: 250,
        chatIntervalMs: 2000,
        warmupSeconds: 5,
        seconds: 10,
        channels: ['socket', 'direct']
    },
    channels: [
        { channel: 'socket', idle: phase(), busy: phase() },
        { channel: 'direct', idle: phase(), busy: phase({ reply: [10, 20, 400] }) }
    ]
};

describe('percentiles', () => {
    test('nearest rank on a fixed array', () => {
        const samples = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(percentiles(samples)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    });

    test('order of the samples does not matter and a single sample is every percentile', () => {
        expect(percentiles([3, 1, 2]).p50).toBe(2);
        expect(percentiles([7])).toEqual({ n: 1, p50: 7, p95: 7, p99: 7, max: 7 });
    });

    test('no samples read as zeros', () => {
        expect(percentiles([])).toEqual({ n: 0, p50: 0, p95: 0, p99: 0, max: 0 });
    });
});

describe('the report', () => {
    const text = renderReport(run, env);

    test('has every section', () => {
        for (const heading of [
            '# Latency under load',
            '## Environment',
            '## Fixture',
            '## What this measures',
            '## Results',
            '### The busy terminal',
            '## Conclusion'
        ]) {
            expect(text).toContain(heading);
        }
    });

    test('names the environment and the fixture', () => {
        expect(text).toContain('abc1234 (uncommitted changes)');
        expect(text).toContain('Apple M4, 10 cores, 32 GiB');
        expect(text).toContain('`yes x`');
    });

    test('has a row per channel, phase and metric', () => {
        const rows = text.split('\n').filter((line) => /^\| (socket|direct) \| (idle|busy terminal) \|/.test(line));
        expect(rows).toHaveLength(2 * 2 * 4);
        expect(text).toContain('| direct | busy terminal | Reply (server.ping) | 3 | 20.0 | 400 | 400 | 400 |');
    });

    test('reports the throughput of the busy terminal', () => {
        expect(text).toContain('| socket | 1.00 | 50 | 2 | 3 |');
    });

    test('leaves the conclusion open', () => {
        expect(text).toContain('To be filled in');
    });
});
