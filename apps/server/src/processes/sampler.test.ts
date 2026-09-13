import { describe, expect, test } from 'bun:test';
import { identityOf, machineRate, parseProcArgs, processRates, sleptBetween, ticksToNs, type RawProcess, type RawSample } from './sampler.ts';

const MACHINE: RawSample['machine'] = { cores: 8, cpuBusy: 0, cpuTotal: 0, memoryUsed: 0, memoryTotal: 16, diskFree: null, diskTotal: null };

const proc = (pid: number, overrides: Partial<RawProcess> = {}): RawProcess => ({
    pid,
    ppid: 1,
    uid: 501,
    startTime: 1_000_000_000,
    name: `p${pid}`,
    path: null,
    readable: true,
    cpuNs: 0,
    memory: 100,
    diskRead: 0,
    diskWrite: 0,
    ...overrides
});

const sample = (at: number, processes: RawProcess[], overrides: Partial<RawSample> = {}): RawSample => ({
    at,
    awakeMs: at,
    asleepMs: 0,
    processes,
    machine: MACHINE,
    ...overrides
});

describe('rates between two readings', () => {
    test('CPU is the difference in CPU time over the awake time between them, as percent of one core', () => {
        const before = sample(10_000, [proc(1, { cpuNs: 1e9 })]);
        const after = sample(12_000, [proc(1, { cpuNs: 2e9, diskWrite: 4096 })]);
        const rate = processRates(before, after).get(identityOf(1, 1_000_000_000))!;
        expect(rate.cpu).toBeCloseTo(50);
        expect(rate.diskWrite).toBe(2048);
        expect(rate.spawned).toBe(false);
    });

    test('a five minute gap averages over five minutes rather than pretending to be two seconds', () => {
        const before = sample(0, [proc(1, { cpuNs: 0 })]);
        const after = sample(300_000, [proc(1, { cpuNs: 30e9 })]);
        expect(processRates(before, after).get(identityOf(1, 1_000_000_000))!.cpu).toBeCloseTo(10);
    });

    test('a reused pid is another process: no rate from the counters of the one before', () => {
        const before = sample(10_000, [proc(7, { startTime: 1_000_000, cpuNs: 50e9 })]);
        const after = sample(12_000, [proc(7, { startTime: 5_000_000, cpuNs: 1e9 })]);
        const rate = processRates(before, after).get(identityOf(7, 5_000_000))!;
        // Started long before the first reading, so nothing says when it spent that second.
        expect(rate.cpu).toBeNull();
        expect(rate.spawned).toBe(true);
    });

    test('a process born inside the interval spent all of its counters there', () => {
        const before = sample(10_000, []);
        const after = sample(12_000, [proc(9, { startTime: 11_000 * 1000, cpuNs: 0.5e9 })]);
        expect(processRates(before, after).get(identityOf(9, 11_000 * 1000))!.cpu).toBeCloseTo(25);
    });

    test('an unreadable process has no numbers, which is not zero', () => {
        const before = sample(10_000, [proc(3, { readable: false, cpuNs: null, memory: null })]);
        const after = sample(12_000, [proc(3, { readable: false, cpuNs: null, memory: null })]);
        expect(processRates(before, after).get(identityOf(3, 1_000_000_000))).toEqual({
            cpu: null,
            memory: null,
            diskRead: null,
            diskWrite: null,
            spawned: false
        });
    });

    test('the first reading has memory but no rates', () => {
        const rate = processRates(null, sample(0, [proc(1)])).get(identityOf(1, 1_000_000_000))!;
        expect(rate.cpu).toBeNull();
        expect(rate.memory).toBe(100);
    });

    test('the machine share is busy ticks over all ticks', () => {
        const before = sample(0, [], { machine: { ...MACHINE, cpuBusy: 100, cpuTotal: 1000 } });
        const after = sample(2000, [], { machine: { ...MACHINE, cpuBusy: 400, cpuTotal: 2000 } });
        expect(machineRate(before, after).cpu).toBeCloseTo(30);
        expect(machineRate(null, after).cpu).toBeNull();
    });
});

describe('the clocks', () => {
    test('Mach ticks become nanoseconds through the timebase', () => {
        expect(ticksToNs(3, 125, 3)).toBe(125);
        expect(ticksToNs(1000, 1, 1)).toBe(1000);
    });

    test('sleep is the boot clock running ahead of the awake clock, not the length of a gap', () => {
        const before = sample(0, [], { asleepMs: 500 });
        expect(sleptBetween(before, sample(300_000, [], { asleepMs: 600 }))).toBe(false);
        expect(sleptBetween(before, sample(4000, [], { asleepMs: 60_500 }))).toBe(true);
    });
});

describe('KERN_PROCARGS2', () => {
    test('reads the arguments and the environment past the executable path and its padding', () => {
        const encoder = new TextEncoder();
        const body = encoder.encode('/bin/sleep\0\0\0\0sleep\x009999\0RUIMTE_SESSION_ID=node-1\0HOME=/Users/x\0\0\0');
        const bytes = new Uint8Array(4 + body.byteLength);
        new DataView(bytes.buffer).setInt32(0, 2, true);
        bytes.set(body, 4);
        expect(parseProcArgs(bytes)).toEqual({ args: ['sleep', '9999'], env: { RUIMTE_SESSION_ID: 'node-1', HOME: '/Users/x' } });
    });
});
