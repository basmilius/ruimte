import { readdirSync, readFileSync, readlinkSync, statfsSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { parseEnvironment, type CommandLine, type ProcessSampler, type RawProcess, type RawSample } from './sampler.ts';

/* USER_HZ: the unit of every tick in `/proc`, fixed at 100 for userspace whatever the kernel runs at. */
const CLOCK_TICKS = 100;

export interface ProcStat {
    name: string;
    ppid: number;
    /* utime plus stime, in ticks. */
    cpuTicks: number;
    /* Ticks since boot. */
    startTicks: number;
}

/* `/proc/<pid>/stat`. The name sits in parentheses and may hold spaces and parentheses of its own, so the fields count from the last one. */
export const parseStat = (text: string): ProcStat | null => {
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open === -1 || close === -1) {
        return null;
    }
    // Field 3 (state) is index 0 here.
    const fields = text
        .slice(close + 2)
        .trim()
        .split(' ');
    const ppid = Number(fields[1]);
    const cpuTicks = Number(fields[11]) + Number(fields[12]);
    const startTicks = Number(fields[19]);
    if (!Number.isFinite(ppid) || !Number.isFinite(cpuTicks) || !Number.isFinite(startTicks)) {
        return null;
    }
    return { name: text.slice(open + 1, close), ppid, cpuTicks, startTicks };
};

/* `Key: value` lines as `/proc/<pid>/status`, `/proc/<pid>/io` and `/proc/meminfo` write them, the first number of each value. */
export const parseKeyValues = (text: string): Map<string, number> => {
    const values = new Map<string, number>();
    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) {
            continue;
        }
        const number = Number.parseInt(line.slice(colon + 1).trim(), 10);
        if (Number.isFinite(number)) {
            values.set(line.slice(0, colon), number);
        }
    }
    return values;
};

/* The first line of `/proc/stat`. Busy is everything but idle and iowait. */
export const parseCpuLine = (text: string): { busy: number; total: number } | null => {
    const line = text.split('\n').find((entry) => entry.startsWith('cpu '));
    if (!line) {
        return null;
    }
    const ticks = line.trim().split(/\s+/).slice(1).map(Number);
    const total = ticks.slice(0, 8).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    const idle = (ticks[3] ?? 0) + (ticks[4] ?? 0);
    return { busy: total - idle, total };
};

const read = (path: string): string | null => {
    try {
        return readFileSync(path, 'latin1');
    } catch {
        return null;
    }
};

export class LinuxSampler implements ProcessSampler {
    private readonly home: string;
    private readonly bootSeconds: number;

    constructor(home: string) {
        this.home = home;
        const btime = /^btime (\d+)$/m.exec(read('/proc/stat') ?? '');
        this.bootSeconds = btime ? Number(btime[1]) : Math.round(Date.now() / 1000 - this.uptimeSeconds());
    }

    sample(): RawSample {
        const awakeMs = performance.timeOrigin + performance.now();
        const at = Date.now();
        const processes: RawProcess[] = [];
        for (const entry of readdirSync('/proc')) {
            const pid = Number(entry);
            if (Number.isInteger(pid) && pid > 0) {
                const process = this.read(pid);
                if (process !== null) {
                    processes.push(process);
                }
            }
        }
        return {
            at,
            awakeMs,
            // CLOCK_BOOTTIME keeps counting through a suspend and the monotonic clock does not.
            asleepMs: this.uptimeSeconds() * 1000 - awakeMs,
            processes,
            machine: this.machine()
        };
    }

    inspect(pid: number): { startTime: number; uid: number } | null {
        const stat = parseStat(read(`/proc/${pid}/stat`) ?? '');
        const status = parseKeyValues(read(`/proc/${pid}/status`) ?? '');
        const uid = status.get('Uid');
        if (stat === null || uid === undefined) {
            return null;
        }
        return { startTime: this.startTimeOf(stat), uid };
    }

    commandLine(pid: number): CommandLine | null {
        const args = read(`/proc/${pid}/cmdline`);
        const environ = read(`/proc/${pid}/environ`);
        if (args === null || environ === null) {
            return null;
        }
        return { args: args.split('\0').filter((arg) => arg !== ''), env: parseEnvironment(environ.split('\0')) };
    }

    private uptimeSeconds(): number {
        return Number.parseFloat(read('/proc/uptime') ?? '0');
    }

    private startTimeOf(stat: ProcStat): number {
        return this.bootSeconds * 1e6 + (stat.startTicks * 1e6) / CLOCK_TICKS;
    }

    private read(pid: number): RawProcess | null {
        const stat = parseStat(read(`/proc/${pid}/stat`) ?? '');
        if (stat === null) {
            return null;
        }
        const status = parseKeyValues(read(`/proc/${pid}/status`) ?? '');
        let path: string | null = null;
        try {
            path = readlinkSync(`/proc/${pid}/exe`);
        } catch {
            // Another user's executable, or a kernel thread that has none.
        }
        // `io` is only readable for processes of this user; the CPU of the others still is.
        const io = read(`/proc/${pid}/io`);
        const counters = io === null ? null : parseKeyValues(io);
        const rss = status.get('VmRSS');
        return {
            pid,
            ppid: stat.ppid,
            uid: status.get('Uid') ?? -1,
            startTime: this.startTimeOf(stat),
            name: stat.name,
            path,
            readable: true,
            cpuNs: (stat.cpuTicks * 1e9) / CLOCK_TICKS,
            memory: rss === undefined ? null : rss * 1024,
            diskRead: counters?.get('read_bytes') ?? null,
            diskWrite: counters?.get('write_bytes') ?? null
        };
    }

    private machine(): RawSample['machine'] {
        const cpu = parseCpuLine(read('/proc/stat') ?? '');
        const memory = parseKeyValues(read('/proc/meminfo') ?? '');
        const total = memory.get('MemTotal');
        const available = memory.get('MemAvailable');
        let diskFree: number | null = null;
        let diskTotal: number | null = null;
        try {
            const volume = statfsSync(this.home);
            diskFree = volume.bavail * volume.bsize;
            diskTotal = volume.blocks * volume.bsize;
        } catch {
            // The rest of the reading still stands.
        }
        return {
            cores: availableParallelism(),
            cpuBusy: cpu?.busy ?? null,
            cpuTotal: cpu?.total ?? null,
            memoryUsed: total !== undefined && available !== undefined ? (total - available) * 1024 : null,
            memoryTotal: total !== undefined ? total * 1024 : totalmem(),
            diskFree,
            diskTotal
        };
    }
}
