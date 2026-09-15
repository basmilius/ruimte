import { errorText } from '../error-text.ts';
/*
 * One reading of the process table. Every counter is cumulative, so a rate is always the difference
 * between two readings over the time between them; that is what keeps a five minute gap honest.
 */

export interface RawProcess {
    pid: number;
    ppid: number;
    uid: number;
    /* Microseconds since the epoch. */
    startTime: number;
    name: string;
    path: string | null;
    /* False when the kernel refused the counters (another user, the system); they are null then. */
    readable: boolean;
    cpuNs: number | null;
    memory: number | null;
    diskRead: number | null;
    diskWrite: number | null;
}

export interface MachineCounters {
    cores: number;
    /* Cumulative ticks over all cores; a share needs two readings. */
    cpuBusy: number | null;
    cpuTotal: number | null;
    memoryUsed: number | null;
    memoryTotal: number;
    diskFree: number | null;
    diskTotal: number | null;
}

export interface RawSample {
    /* Epoch milliseconds. */
    at: number;
    /* A clock that stops while the machine sleeps; every elapsed time is measured on it. */
    awakeMs: number;
    /* The boot clock minus the awake clock: it only grows while the machine sleeps. */
    asleepMs: number;
    processes: RawProcess[];
    machine: MachineCounters;
}

export interface CommandLine {
    args: string[];
    env: Record<string, string>;
}

export interface ProcessSampler {
    sample(): RawSample;
    /* One process, for the check right before a signal. */
    inspect(pid: number): { startTime: number; uid: number } | null;
    /* The arguments and environment of a process of this user; null when the kernel refuses. */
    commandLine(pid: number): CommandLine | null;
}

export interface ProcessRate {
    /* Percent of one core. */
    cpu: number | null;
    memory: number | null;
    /* Bytes per second. */
    diskRead: number | null;
    diskWrite: number | null;
    /* The process was not in the reading before; a new process is a sign of life. */
    spawned: boolean;
}

export interface MachineRate {
    /* Percent of all cores. */
    cpu: number | null;
}

/* More sleep than this between two readings and the history starts over; less is clock jitter. */
export const SLEEP_TOLERANCE_MS = 2000;

export const identityOf = (pid: number, startTime: number): string => `${pid}:${startTime}`;

/* Mach ticks to nanoseconds. On Apple silicon a tick is 125/3 ns, so the raw number reads 40 times too low. */
export const ticksToNs = (ticks: number, numer: number, denom: number): number => (ticks * numer) / denom;

/* Whether the machine slept between two readings. How long the gap was says nothing: a closed panel samples every five minutes. */
export const sleptBetween = (before: RawSample, after: RawSample): boolean => after.asleepMs - before.asleepMs > SLEEP_TOLERANCE_MS;

const perSecond = (now: number | null, then: number | null, elapsedMs: number): number | null =>
    now === null || then === null ? null : (Math.max(0, now - then) * 1000) / elapsedMs;

/*
 * The rate of every process over the time since `before`. A process that started after `before` was
 * taken spent all its counters inside the interval, so it has a rate on its first sight too; one
 * that was already running but not in `before` has none yet, because nothing says when it spent them.
 */
export const processRates = (before: RawSample | null, after: RawSample): Map<string, ProcessRate> => {
    const rates = new Map<string, ProcessRate>();
    const previous = new Map<string, RawProcess>();
    for (const process of before?.processes ?? []) {
        previous.set(identityOf(process.pid, process.startTime), process);
    }
    const elapsedMs = before === null ? 0 : after.awakeMs - before.awakeMs;
    for (const process of after.processes) {
        const identity = identityOf(process.pid, process.startTime);
        const seen = previous.get(identity);
        if (!process.readable) {
            rates.set(identity, { cpu: null, memory: null, diskRead: null, diskWrite: null, spawned: false });
            continue;
        }
        const bornInside = before !== null && seen === undefined && process.startTime >= before.at * 1000;
        const base = seen?.readable ? seen : bornInside ? { cpuNs: 0, diskRead: 0, diskWrite: 0 } : null;
        const measurable = base !== null && elapsedMs > 0;
        rates.set(identity, {
            cpu: measurable && process.cpuNs !== null && base.cpuNs !== null ? (Math.max(0, process.cpuNs - base.cpuNs) / 1e6 / elapsedMs) * 100 : null,
            memory: process.memory,
            diskRead: measurable ? perSecond(process.diskRead, base.diskRead, elapsedMs) : null,
            diskWrite: measurable ? perSecond(process.diskWrite, base.diskWrite, elapsedMs) : null,
            spawned: before !== null && seen === undefined
        });
    }
    return rates;
};

export const machineRate = (before: RawSample | null, after: RawSample): MachineRate => {
    const then = before?.machine;
    const now = after.machine;
    if (!then || then.cpuBusy === null || then.cpuTotal === null || now.cpuBusy === null || now.cpuTotal === null || now.cpuTotal <= then.cpuTotal) {
        return { cpu: null };
    }
    return { cpu: (Math.max(0, now.cpuBusy - then.cpuBusy) / (now.cpuTotal - then.cpuTotal)) * 100 };
};

/*
 * `KERN_PROCARGS2`: the argument count, the executable path and its padding, the arguments, then the
 * environment, every string closed by a zero byte.
 */
export const parseProcArgs = (bytes: Uint8Array): CommandLine | null => {
    if (bytes.byteLength < 4) {
        return null;
    }
    const argc = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
    let offset = 4;
    while (offset < bytes.byteLength && bytes[offset] !== 0) {
        offset++;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0) {
        offset++;
    }
    const decoder = new TextDecoder();
    const strings: string[] = [];
    let start = offset;
    for (let i = offset; i < bytes.byteLength; i++) {
        if (bytes[i] !== 0) {
            continue;
        }
        if (i === start && strings.length >= argc) {
            // A double zero after the environment is where the area ends.
            break;
        }
        strings.push(decoder.decode(bytes.subarray(start, i)));
        start = i + 1;
    }
    return { args: strings.slice(0, argc), env: parseEnvironment(strings.slice(argc)) };
};

export const parseEnvironment = (entries: readonly string[]): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const entry of entries) {
        const equals = entry.indexOf('=');
        if (equals > 0) {
            env[entry.slice(0, equals)] = entry.slice(equals + 1);
        }
    }
    return env;
};

/* The sampler of this platform, or null where there is none (Windows); the panel explains that instead. */
export const createSampler = async (platform: string = process.platform, home: string = process.env.HOME ?? '/'): Promise<ProcessSampler | null> => {
    try {
        if (platform === 'darwin') {
            const { DarwinSampler } = await import('./darwin.ts');
            return new DarwinSampler(home);
        }
        if (platform === 'linux') {
            const { LinuxSampler } = await import('./linux.ts');
            return new LinuxSampler(home);
        }
    } catch (e) {
        console.error('The process sampler could not start:', errorText(e));
    }
    return null;
};
