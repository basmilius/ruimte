import { describe, expect, test } from 'bun:test';
import type { SessionEvent } from '../sessions/manager.ts';
import { COARSE_INTERVAL_MS, FINE_POINTS, ProcessMonitor } from './monitor.ts';
import { type ProcessSampler, type RawProcess, type RawSample } from './sampler.ts';

const MACHINE: RawSample['machine'] = { cores: 4, cpuBusy: 0, cpuTotal: 0, memoryUsed: 1000, memoryTotal: 4000, diskFree: null, diskTotal: null };

const proc = (pid: number, ppid: number, cpuNs: number, overrides: Partial<RawProcess> = {}): RawProcess => ({
    pid,
    ppid,
    uid: 501,
    startTime: pid * 1000,
    name: `p${pid}`,
    path: null,
    readable: true,
    cpuNs,
    memory: 10,
    diskRead: 0,
    diskWrite: 0,
    ...overrides
});

/* A machine whose clock and CPU move only when the test says so. */
class FakeSampler implements ProcessSampler {
    at = 1_800_000_000_000;
    awake = 0;
    asleep = 0;
    cpuNs = 0;
    busy = 0;
    total = 0;

    advance(ms: number, { sleepMs = 0, cpuMs = 0 } = {}): void {
        this.at += ms + sleepMs;
        this.awake += ms;
        this.asleep += sleepMs;
        this.cpuNs += cpuMs * 1e6;
        this.busy += ms / 10;
        this.total += ms;
    }

    sample(): RawSample {
        return {
            at: this.at,
            awakeMs: this.awake,
            asleepMs: this.asleep,
            processes: [proc(1, 0, 0), proc(100, 1, this.cpuNs), proc(200, 100, 0, { name: 'zsh' })],
            machine: { ...MACHINE, cpuBusy: this.busy, cpuTotal: this.total }
        };
    }

    inspect(pid: number): { startTime: number; uid: number } | null {
        return pid === 200 ? { startTime: 200_000, uid: 501 } : pid === 300 ? { startTime: 300_000, uid: 0 } : null;
    }

    commandLine(): null {
        return null;
    }
}

const monitorWith = (sampler: ProcessSampler | null, signals: [number, string][] = []) =>
    new ProcessMonitor({
        sampler,
        sessions: () => [{ id: 'term-1', pid: 200, exited: false, agent: null }],
        chats: () => [],
        contextUrl: () => null,
        reportsEnd: () => true,
        daemonPid: 100,
        uid: 501,
        signal: (pid, signal) => signals.push([pid, signal])
    });

const recorder = () => {
    const events: SessionEvent[] = [];
    return { events, sink: (event: SessionEvent) => events.push(event) };
};

describe('the tempo and the series', () => {
    test('a panel that opens gets the coarse day at once and a fine point from the next tick on', () => {
        const sampler = new FakeSampler();
        const monitor = monitorWith(sampler);
        for (let i = 0; i < 3; i++) {
            monitor.sampleNow(true);
            sampler.advance(COARSE_INTERVAL_MS, { cpuMs: 30_000 });
        }
        const client = recorder();
        monitor.subscribe('a', client.sink);
        const opened = monitor.follow('a', { scope: 'ruimte', sort: 'cpu' });
        expect(opened.coarse).toHaveLength(3);
        expect(opened.fine).toHaveLength(0);
        expect(opened.sample?.groups.map((group) => group.id)).toEqual(['terminal:term-1', 'daemon']);

        sampler.advance(2000, { cpuMs: 1000 });
        monitor.sampleNow(true);
        const event = client.events.findLast((entry) => entry.event === 'processes.sample');
        expect(event?.event === 'processes.sample' && event.payload.fine?.cpuRuimte).toBeCloseTo(50 / 4);
        expect(event?.event === 'processes.sample' && event.payload.fine?.cpu).toBeCloseTo(10);
    });

    test('the fine series is capped and a nudge out of rhythm adds no point', () => {
        const sampler = new FakeSampler();
        const monitor = monitorWith(sampler);
        monitor.subscribe('a', () => undefined);
        monitor.follow('a', { scope: 'ruimte', sort: 'cpu' });
        for (let i = 0; i < FINE_POINTS + 20; i++) {
            sampler.advance(2000);
            monitor.sampleNow(true);
        }
        sampler.advance(500);
        monitor.sampleNow(false);
        monitor.follow('b', { scope: 'all', sort: 'memory' });
        expect(monitor.follow('b', { scope: 'all', sort: 'memory' }).fine).toHaveLength(FINE_POINTS);
    });

    test('closing the last panel does not let the next fine point average over the closed stretch', () => {
        const sampler = new FakeSampler();
        const monitor = monitorWith(sampler);
        const client = recorder();
        monitor.subscribe('a', client.sink);
        monitor.follow('a', { scope: 'ruimte', sort: 'cpu' });
        monitor.unfollow('a');
        sampler.advance(60_000);
        monitor.sampleNow(true);
        monitor.follow('a', { scope: 'ruimte', sort: 'cpu' });
        expect(monitor.follow('a', { scope: 'ruimte', sort: 'cpu' }).fine).toHaveLength(0);
    });

    test('sleep starts the history over; a five minute gap does not', () => {
        const sampler = new FakeSampler();
        const monitor = monitorWith(sampler);
        for (let i = 0; i < 3; i++) {
            monitor.sampleNow(true);
            sampler.advance(COARSE_INTERVAL_MS);
        }
        monitor.sampleNow(true);
        expect(monitor.follow('a', { scope: 'ruimte', sort: 'cpu' }).coarse).toHaveLength(3);
        monitor.unfollow('a');
        sampler.advance(COARSE_INTERVAL_MS, { sleepMs: 8 * 3_600_000 });
        monitor.sampleNow(true);
        expect(monitor.follow('a', { scope: 'ruimte', sort: 'cpu' }).coarse).toHaveLength(0);
    });

    test('a platform without a sampler says so', () => {
        expect(monitorWith(null).follow('a', { scope: 'ruimte', sort: 'cpu' }).supported).toBe(false);
    });
});

describe('signals', () => {
    test('go out only to a process that is still the one the panel showed, and of this user', () => {
        const signals: [number, string][] = [];
        const monitor = monitorWith(new FakeSampler(), signals);
        monitor.signal({ pid: 200, startTime: 200_000, signal: 'SIGTERM' });
        expect(signals).toEqual([[200, 'SIGTERM']]);
        expect(() => monitor.signal({ pid: 200, startTime: 199_000, signal: 'SIGKILL' })).toThrow('ended');
        expect(() => monitor.signal({ pid: 300, startTime: 300_000, signal: 'SIGKILL' })).toThrow('another user');
        expect(() => monitor.signal({ pid: 100, startTime: 100_000, signal: 'SIGKILL' })).toThrow('itself');
        expect(signals).toHaveLength(1);
    });
});
