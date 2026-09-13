import { dlopen, FFIType, ptr } from 'bun:ffi';
import { statfsSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { identityOf, parseProcArgs, ticksToNs, type CommandLine, type ProcessSampler, type RawProcess, type RawSample } from './sampler.ts';

/*
 * libproc and the Mach host calls through `bun:ffi`: the whole process table in a couple of
 * milliseconds, without `ps`, a native addon or a helper process. The struct offsets below are from
 * the macOS SDK headers (`sys/proc_info.h`, `sys/resource.h`, `mach/vm_statistics.h`); the test
 * holds them against `ps`.
 */

const PROC_PIDTBSDINFO = 3;
const PROC_BSDINFO_SIZE = 136;
// The short form answers for processes of other users too, where the full one is refused.
const PROC_PIDT_SHORTBSDINFO = 13;
const PROC_BSDSHORTINFO_SIZE = 64;
const RUSAGE_INFO_V4 = 4;
// rusage_info_v4 is 296 bytes; the slack keeps a newer kernel from writing past the buffer.
const RUSAGE_SIZE = 512;
const PROC_PIDPATHINFO_MAXSIZE = 4096;
const HOST_CPU_LOAD_INFO = 3;
const HOST_VM_INFO64 = 4;
const HOST_VM_INFO64_COUNT = 38;
const CTL_KERN = 1;
const KERN_PROCARGS2 = 49;

const BSD = { ppid: 16, uid: 20, comm: 48, commLength: 16, name: 64, nameLength: 32, startSec: 120, startUsec: 128 } as const;
const SHORT = { ppid: 4, comm: 16, commLength: 16, uid: 36 } as const;
const RUSAGE = { userTime: 16, systemTime: 24, footprint: 72, diskRead: 144, diskWrite: 152 } as const;
const VM = { wire: 12, purgeable: 88, compressor: 128, internal: 140 } as const;

const libproc = () =>
    dlopen('/usr/lib/libproc.dylib', {
        proc_listallpids: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
        proc_pidpath: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }
    });

const libsystem = () =>
    dlopen('/usr/lib/libSystem.B.dylib', {
        mach_timebase_info: { args: [FFIType.ptr], returns: FFIType.i32 },
        mach_absolute_time: { args: [], returns: FFIType.u64 },
        mach_continuous_time: { args: [], returns: FFIType.u64 },
        mach_host_self: { args: [], returns: FFIType.u32 },
        host_statistics: { args: [FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        host_statistics64: { args: [FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        sysctl: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
        getpagesize: { args: [], returns: FFIType.i32 }
    });

const decoder = new TextDecoder();

const cString = (bytes: Uint8Array, offset: number, length: number): string => {
    const slice = bytes.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
};

/* Two 32 bit halves rather than a BigInt: at 1,500 processes a BigInt per counter is most of the cost. */
const u64 = (view: DataView, offset: number): number => view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;

interface Described {
    name: string;
    path: string | null;
}

export class DarwinSampler implements ProcessSampler {
    private readonly proc = libproc();
    private readonly system = libsystem();
    private readonly home: string;
    private readonly numer: number;
    private readonly denom: number;
    private readonly pageSize: number;
    // One port for the life of the daemon: every call to `mach_host_self` hands out another send right.
    private readonly host: number;
    private pids = new Int32Array(4096);
    private readonly bsd = new Uint8Array(PROC_BSDINFO_SIZE);
    private readonly bsdView = new DataView(this.bsd.buffer);
    // A typed array never moves, so its pointer is taken once rather than on each of 4,000 calls.
    private readonly bsdPointer = ptr(this.bsd);
    private readonly short = new Uint8Array(PROC_BSDSHORTINFO_SIZE);
    private readonly shortView = new DataView(this.short.buffer);
    private readonly shortPointer = ptr(this.short);
    private readonly rusage = new Uint8Array(RUSAGE_SIZE);
    private readonly rusageView = new DataView(this.rusage.buffer);
    private readonly rusagePointer = ptr(this.rusage);
    private readonly pathBuffer = new Uint8Array(PROC_PIDPATHINFO_MAXSIZE);
    private readonly pathPointer = ptr(this.pathBuffer);
    private readonly cpuLoad = new Uint32Array(4);
    private readonly vm = new Uint8Array(HOST_VM_INFO64_COUNT * 4);
    private readonly vmView = new DataView(this.vm.buffer);
    // A name and a path never change for a process, and decoding them is most of what a reading costs.
    private described = new Map<string, Described>();

    constructor(home: string) {
        this.home = home;
        const timebase = new Uint32Array(2);
        this.system.symbols.mach_timebase_info(ptr(timebase));
        this.numer = timebase[0] || 1;
        this.denom = timebase[1] || 1;
        this.pageSize = this.system.symbols.getpagesize();
        this.host = this.system.symbols.mach_host_self();
    }

    sample(): RawSample {
        const awake = Number(this.system.symbols.mach_absolute_time());
        const booted = Number(this.system.symbols.mach_continuous_time());
        const at = Date.now();
        const processes: RawProcess[] = [];
        const described = new Map<string, Described>();
        for (const pid of this.listPids()) {
            const process = this.read(pid, described);
            if (process !== null) {
                processes.push(process);
            }
        }
        this.described = described;
        return {
            at,
            awakeMs: ticksToNs(awake, this.numer, this.denom) / 1e6,
            asleepMs: ticksToNs(booted - awake, this.numer, this.denom) / 1e6,
            processes,
            machine: this.machine()
        };
    }

    inspect(pid: number): { startTime: number; uid: number } | null {
        if (this.proc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0n, this.bsdPointer, PROC_BSDINFO_SIZE) !== PROC_BSDINFO_SIZE) {
            return null;
        }
        return { startTime: this.startTime(), uid: this.bsdView.getUint32(BSD.uid, true) };
    }

    commandLine(pid: number): CommandLine | null {
        const mib = new Int32Array([CTL_KERN, KERN_PROCARGS2, pid]);
        const size = new BigUint64Array(1);
        if (this.system.symbols.sysctl(ptr(mib), 3, null, ptr(size), null, 0n) !== 0 || size[0] === 0n) {
            return null;
        }
        const buffer = new Uint8Array(Number(size[0]));
        if (this.system.symbols.sysctl(ptr(mib), 3, ptr(buffer), ptr(size), null, 0n) !== 0) {
            return null;
        }
        return parseProcArgs(buffer.subarray(0, Number(size[0])));
    }

    private listPids(): Int32Array {
        for (;;) {
            const count = this.proc.symbols.proc_listallpids(ptr(this.pids), this.pids.byteLength);
            if (count < 0) {
                return new Int32Array(0);
            }
            // A full buffer may have cut the list short; the table grew since the last reading.
            if (count < this.pids.length) {
                return this.pids.subarray(0, count);
            }
            this.pids = new Int32Array(this.pids.length * 2);
        }
    }

    private startTime(): number {
        return u64(this.bsdView, BSD.startSec) * 1e6 + u64(this.bsdView, BSD.startUsec);
    }

    private read(pid: number, described: Map<string, Described>): RawProcess | null {
        if (pid <= 0) {
            return null;
        }
        if (this.proc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0n, this.bsdPointer, PROC_BSDINFO_SIZE) !== PROC_BSDINFO_SIZE) {
            return this.readForeign(pid);
        }
        const startTime = this.startTime();
        const identity = identityOf(pid, startTime);
        let description = this.described.get(identity);
        if (description === undefined) {
            const length = this.proc.symbols.proc_pidpath(pid, this.pathPointer, PROC_PIDPATHINFO_MAXSIZE);
            description = {
                name: cString(this.bsd, BSD.name, BSD.nameLength) || cString(this.bsd, BSD.comm, BSD.commLength),
                path: length > 0 ? decoder.decode(this.pathBuffer.subarray(0, length)) : null
            };
        }
        described.set(identity, description);
        const readable = this.proc.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V4, this.rusagePointer) === 0;
        const view = this.rusageView;
        return {
            pid,
            ppid: this.bsdView.getUint32(BSD.ppid, true),
            uid: this.bsdView.getUint32(BSD.uid, true),
            startTime,
            name: description.name,
            path: description.path,
            readable,
            cpuNs: readable ? ticksToNs(u64(view, RUSAGE.userTime) + u64(view, RUSAGE.systemTime), this.numer, this.denom) : null,
            memory: readable ? u64(view, RUSAGE.footprint) : null,
            diskRead: readable ? u64(view, RUSAGE.diskRead) : null,
            diskWrite: readable ? u64(view, RUSAGE.diskWrite) : null
        };
    }

    /*
     * A process of another user: the kernel names it and its parent but gives no start time and no
     * counters. It is listed dimmed; without a start time it can never be signaled, which is right.
     */
    private readForeign(pid: number): RawProcess | null {
        if (this.proc.symbols.proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0n, this.shortPointer, PROC_BSDSHORTINFO_SIZE) !== PROC_BSDSHORTINFO_SIZE) {
            return null;
        }
        return {
            pid,
            ppid: this.shortView.getUint32(SHORT.ppid, true),
            uid: this.shortView.getUint32(SHORT.uid, true),
            startTime: 0,
            name: cString(this.short, SHORT.comm, SHORT.commLength),
            path: null,
            readable: false,
            cpuNs: null,
            memory: null,
            diskRead: null,
            diskWrite: null
        };
    }

    private machine(): RawSample['machine'] {
        const cores = availableParallelism();
        let cpuBusy: number | null = null;
        let cpuTotal: number | null = null;
        const cpuCount = new Uint32Array([4]);
        if (this.system.symbols.host_statistics(this.host, HOST_CPU_LOAD_INFO, ptr(this.cpuLoad), ptr(cpuCount)) === 0) {
            // user, system, idle, nice
            const [user = 0, system = 0, idle = 0, nice = 0] = this.cpuLoad;
            cpuBusy = user + system + nice;
            cpuTotal = cpuBusy + idle;
        }
        let memoryUsed: number | null = null;
        const vmCount = new Uint32Array([HOST_VM_INFO64_COUNT]);
        if (this.system.symbols.host_statistics64(this.host, HOST_VM_INFO64, ptr(this.vm), ptr(vmCount)) === 0) {
            const view = this.vmView;
            // What Activity Monitor calls Memory Used: app memory, wired and compressed.
            const pages =
                view.getUint32(VM.internal, true) - view.getUint32(VM.purgeable, true) + view.getUint32(VM.wire, true) + view.getUint32(VM.compressor, true);
            memoryUsed = pages * this.pageSize;
        }
        let diskFree: number | null = null;
        let diskTotal: number | null = null;
        try {
            const volume = statfsSync(this.home);
            diskFree = volume.bavail * volume.bsize;
            diskTotal = volume.blocks * volume.bsize;
        } catch {
            // A home on a volume that went away; the rest of the reading still stands.
        }
        return { cores, cpuBusy, cpuTotal, memoryUsed, memoryTotal: totalmem(), diskFree, diskTotal };
    }
}
