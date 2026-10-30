import { dlopen, FFIType, ptr } from 'bun:ffi';
import { availableParallelism, freemem, totalmem } from 'node:os';
import type { ListenerProbe, TcpListener } from './listeners.ts';
import { diskSpace, identityOf, parseEnvironment, type CommandLine, type ProcessSampler, type RawProcess, type RawSample } from './sampler.ts';

/*
 * The Win32 API through `bun:ffi`, as on macOS: a process per reading is what costs on Windows. One
 * `NtQuerySystemInformation` call answers the whole table with its counters, also for processes that
 * refuse a handle, so a handle is opened only once per process, for its path and owner. Offsets are
 * those of x64, the only Windows build Ruimte ships; the integration test holds them against a real table.
 */

const SYSTEM_PROCESS_INFORMATION = 5;
const STATUS_INFO_LENGTH_MISMATCH = -1073741820;
const MAX_TABLE_BYTES = 64 * 1024 * 1024;
const PROCESS_BASIC_INFORMATION = 0;
const PROCESS_CONSOLE_HOST_PROCESS = 49;
const PROCESS_COMMAND_LINE_INFORMATION = 60;
const PROCESS_VM_READ = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x8;
const TOKEN_USER = 1;
const AF_INET = 2;
const AF_INET6 = 23;
const TCP_TABLE_OWNER_PID_LISTENER = 3;
const ERROR_INSUFFICIENT_BUFFER = 122;
const MAX_ENVIRONMENT_BYTES = 1024 * 1024;

const ENTRY = {
    next: 0,
    privateWorkingSet: 8,
    createTime: 32,
    userTime: 40,
    kernelTime: 48,
    imageName: 56,
    pid: 80,
    ppid: 88,
    readBytes: 232,
    writeBytes: 240
} as const;
const PEB_PROCESS_PARAMETERS = 0x20;
const PARAMETERS_ENVIRONMENT = 0x80;
const PARAMETERS_ENVIRONMENT_SIZE = 0x3f0;
const TCP4_ROW = { size: 24, address: 4, port: 8, pid: 20 } as const;
const TCP6_ROW = { size: 56, address: 0, port: 20, pid: 52 } as const;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

/* What `process.getuid` answers on Windows, which has none: the monitor compares against this for "of this user". */
const OWN_UID = -1;
const FOREIGN_UID = -2;
/* POSIX hands an orphan to init; the monitor recognizes a stray by that parent. */
const ORPHAN_PPID = 1;

export interface NativeProcess {
    pid: number;
    ppid: number;
    /* Microseconds since the epoch; 0 for a process the system started without a time. */
    startTime: number;
    name: string;
    cpuNs: number;
    memory: number;
    diskRead: number;
    diskWrite: number;
}

function unicodeString(bytes: Uint8Array, view: DataView, offset: number, base: number): string {
    const length = view.getUint16(offset, true);
    const address = Number(view.getBigUint64(offset + 8, true));
    if (length === 0 || address === 0) {
        return '';
    }
    const start = address - base;
    return Buffer.from(bytes.buffer, bytes.byteOffset + start, length).toString('utf16le');
}

export function fileTimeToMicros(fileTime: bigint): number {
    return fileTime <= FILETIME_EPOCH_OFFSET ? 0 : Number((fileTime - FILETIME_EPOCH_OFFSET) / 10n);
}

/* Reads a `SYSTEM_PROCESS_INFORMATION` chain. The names point into the buffer, whose address is `base`. */
export function parseProcessTable(bytes: Uint8Array, base: number): NativeProcess[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const processes: NativeProcess[] = [];
    let offset = 0;
    while (true) {
        const pid = Number(view.getBigUint64(offset + ENTRY.pid, true));
        // Pid 0 is the idle count, not a process.
        if (pid !== 0) {
            const user = view.getBigInt64(offset + ENTRY.userTime, true);
            const kernel = view.getBigInt64(offset + ENTRY.kernelTime, true);
            processes.push({
                pid,
                ppid: Number(view.getBigUint64(offset + ENTRY.ppid, true)),
                startTime: fileTimeToMicros(view.getBigInt64(offset + ENTRY.createTime, true)),
                name: unicodeString(bytes, view, offset + ENTRY.imageName, base).replace(/\.exe$/i, ''),
                cpuNs: Number((user + kernel) * 100n),
                memory: Number(view.getBigInt64(offset + ENTRY.privateWorkingSet, true)),
                diskRead: Number(view.getBigInt64(offset + ENTRY.readBytes, true)),
                diskWrite: Number(view.getBigInt64(offset + ENTRY.writeBytes, true))
            });
        }
        const next = view.getUint32(offset + ENTRY.next, true);
        if (next === 0) {
            return processes;
        }
        offset += next;
    }
}

/*
 * Windows keeps the pid of a parent that ended, and may hand that pid to a newer process. A parent
 * that is gone or younger than its child is no parent, so a tree never adopts a stranger's children.
 */
export function settledParent(process: Pick<NativeProcess, 'ppid' | 'startTime'>, parent: Pick<NativeProcess, 'startTime'> | undefined): number {
    return parent === undefined || parent.startTime > process.startTime ? ORPHAN_PPID : process.ppid;
}

/*
 * The first process on each console, which holds a terminal's shell. An MSYS `exec` ends the Windows
 * process it ran in, so everything Git Bash runs from an MSYS program (`sh`, an npm shim) has lost its
 * parent while still on the terminal's console; that console is what ties it to its session.
 */
export function consoleRoots(
    processes: readonly { pid: number; startTime: number; consoleHost: number | null }[]
): Map<number, { pid: number; startTime: number }> {
    const roots = new Map<number, { pid: number; startTime: number }>();
    for (const process of processes) {
        const root = process.consoleHost === null ? undefined : roots.get(process.consoleHost);
        if (process.consoleHost !== null && process.startTime > 0 && (root === undefined || process.startTime < root.startTime)) {
            roots.set(process.consoleHost, { pid: process.pid, startTime: process.startTime });
        }
    }
    return roots;
}

/* The rules of `CommandLineToArgvW`: 2n backslashes before a quote are n and the quote counts, 2n+1 are n and a literal quote. */
export function parseCommandLine(line: string): string[] {
    const args: string[] = [];
    let current = '';
    let started = false;
    let quoted = false;
    let backslashes = 0;
    const flushBackslashes = (): void => {
        current += '\\'.repeat(backslashes);
        backslashes = 0;
    };
    for (let i = 0; i < line.length; i++) {
        const character = line[i]!;
        if (character === '\\') {
            backslashes++;
            started = true;
            continue;
        }
        if (character === '"') {
            const literal = backslashes % 2 === 1;
            current += '\\'.repeat(Math.floor(backslashes / 2));
            backslashes = 0;
            started = true;
            if (literal) {
                current += '"';
            } else if (quoted && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        flushBackslashes();
        if ((character === ' ' || character === '\t') && !quoted) {
            if (started) {
                args.push(current);
                current = '';
                started = false;
            }
            continue;
        }
        current += character;
        started = true;
    }
    flushBackslashes();
    if (started) {
        args.push(current);
    }
    return args;
}

function ipv6Text(address: Uint8Array): string {
    const groups = Array.from({ length: 8 }, (_, i) => ((address[i * 2]! << 8) | address[i * 2 + 1]!).toString(16));
    if (groups.slice(0, 5).every((group) => group === '0') && groups[5] === 'ffff') {
        return `[::ffff:${[...address.subarray(12)].join('.')}]`;
    }
    const joined = groups.join(':');
    const longest = (joined.match(/(^|:)0(:0)+(:|$)/g) ?? []).sort((one, other) => other.length - one.length)[0];
    return `[${longest === undefined ? joined : joined.replace(longest, '::')}]`;
}

/* A `MIB_TCPTABLE_OWNER_PID` or `MIB_TCP6TABLE_OWNER_PID`, holding only listeners by what was asked for. A port is in network order. */
export function parseTcpTable(bytes: Uint8Array, family: 'ipv4' | 'ipv6'): TcpListener[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const row = family === 'ipv4' ? TCP4_ROW : TCP6_ROW;
    const listeners: TcpListener[] = [];
    const count = view.getUint32(0, true);
    for (let i = 0; i < count; i++) {
        const at = 4 + i * row.size;
        const address = bytes.subarray(at + row.address, at + row.address + (family === 'ipv4' ? 4 : 16));
        listeners.push({
            pid: view.getUint32(at + row.pid, true),
            port: view.getUint16(at + row.port, false),
            host: family === 'ipv4' ? '127.0.0.1' : '[::1]',
            bindAddress: family === 'ipv4' ? [...address].join('.') : ipv6Text(address)
        });
    }
    return listeners;
}

function kernel32() {
    return dlopen('kernel32.dll', {
        OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
        CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
        QueryFullProcessImageNameW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        ReadProcessMemory: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
        GetSystemTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        QueryUnbiasedInterruptTime: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetTickCount64: { args: [], returns: FFIType.u64 }
    });
}

function ntdll() {
    return dlopen('ntdll.dll', {
        NtQuerySystemInformation: { args: [FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
        NtQueryInformationProcess: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 }
    });
}

function advapi32() {
    return dlopen('advapi32.dll', {
        OpenProcessToken: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
        GetTokenInformation: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 }
    });
}

interface Details {
    path: string | null;
    own: boolean;
    consoleHost: number | null;
}

export class WindowsSampler implements ProcessSampler {
    private readonly home: string;
    private readonly kernel = kernel32();
    private readonly nt = ntdll();
    private readonly advapi = advapi32();
    private readonly outLength = new Uint8Array(8);
    private readonly pathBuffer = new Uint8Array(65536);
    private readonly tokenBuffer = new Uint8Array(256);
    private readonly ownSid: string | null;
    private tableBuffer = new Uint8Array(1024 * 1024);
    private details = new Map<string, Details>();

    constructor(home: string) {
        this.home = home;
        this.ownSid = this.withHandle(process.pid, PROCESS_QUERY_LIMITED_INFORMATION, (handle) => this.sidOf(handle));
    }

    sample(): RawSample {
        const table = this.table();
        const byPid = new Map(table.map((entry) => [entry.pid, entry]));
        const details = new Map<string, Details>();
        for (const entry of table) {
            const identity = identityOf(entry.pid, entry.startTime);
            details.set(identity, this.details.get(identity) ?? this.detailsOf(entry.pid));
        }
        const detailsOf = (entry: NativeProcess): Details => details.get(identityOf(entry.pid, entry.startTime))!;
        const roots = consoleRoots(table.map((entry) => ({ ...entry, consoleHost: detailsOf(entry).consoleHost })));
        const processes = table.map((entry): RawProcess => {
            const known = detailsOf(entry);
            const parent = settledParent(entry, byPid.get(entry.ppid));
            const root = known.consoleHost === null ? undefined : roots.get(known.consoleHost);
            return {
                pid: entry.pid,
                ppid: parent === ORPHAN_PPID && known.own && root !== undefined && root.startTime < entry.startTime ? root.pid : parent,
                uid: known.own ? OWN_UID : FOREIGN_UID,
                startTime: entry.startTime,
                name: entry.name,
                path: known.path,
                readable: true,
                cpuNs: entry.cpuNs,
                memory: entry.memory,
                diskRead: entry.diskRead,
                diskWrite: entry.diskWrite
            };
        });
        this.details = details;
        const awake = new BigUint64Array(1);
        this.kernel.symbols.QueryUnbiasedInterruptTime(ptr(awake));
        const awakeMs = Number(awake[0]! / 10000n);
        const bootMs = Number(this.kernel.symbols.GetTickCount64());
        const total = totalmem();
        return {
            at: Date.now(),
            awakeMs,
            asleepMs: Math.max(0, bootMs - awakeMs),
            processes,
            machine: { cores: availableParallelism(), ...this.cpuTimes(), memoryUsed: total - freemem(), memoryTotal: total, ...diskSpace(this.home) }
        };
    }

    // Through the table, which also answers for a process that refuses a handle.
    inspect(pid: number): { startTime: number; uid: number } | null {
        const entry = this.table().find((candidate) => candidate.pid === pid);
        if (entry === undefined) {
            return null;
        }
        return { startTime: entry.startTime, uid: this.detailsOf(pid).own ? OWN_UID : FOREIGN_UID };
    }

    commandLine(pid: number): CommandLine | null {
        return this.withHandle(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, (handle) => {
            const line = this.commandLineText(handle);
            return line === null ? null : { args: parseCommandLine(line), env: this.environmentOf(handle) };
        });
    }

    private table(): NativeProcess[] {
        while (true) {
            const status = this.nt.symbols.NtQuerySystemInformation(
                SYSTEM_PROCESS_INFORMATION,
                ptr(this.tableBuffer),
                this.tableBuffer.byteLength,
                ptr(this.outLength)
            );
            if (status === STATUS_INFO_LENGTH_MISMATCH && this.tableBuffer.byteLength < MAX_TABLE_BYTES) {
                this.tableBuffer = new Uint8Array(this.tableBuffer.byteLength * 2);
                continue;
            }
            if (status !== 0) {
                throw new Error(`NtQuerySystemInformation answered ${status}`);
            }
            return parseProcessTable(this.tableBuffer, ptr(this.tableBuffer));
        }
    }

    private cpuTimes(): { cpuBusy: number | null; cpuTotal: number | null } {
        const idle = new BigUint64Array(1);
        const kernel = new BigUint64Array(1);
        const user = new BigUint64Array(1);
        if (this.kernel.symbols.GetSystemTimes(ptr(idle), ptr(kernel), ptr(user)) === 0) {
            return { cpuBusy: null, cpuTotal: null };
        }
        // Kernel time includes the idle time.
        const total = kernel[0]! + user[0]!;
        return { cpuBusy: Number(total - idle[0]!), cpuTotal: Number(total) };
    }

    private detailsOf(pid: number): Details {
        const found = this.withHandle(pid, PROCESS_QUERY_LIMITED_INFORMATION, (handle) => ({
            path: this.pathOf(handle),
            own: this.ownSid !== null && this.sidOf(handle) === this.ownSid,
            consoleHost: this.consoleHostOf(handle)
        }));
        return found ?? { path: null, own: false, consoleHost: null };
    }

    private withHandle<T>(pid: number, access: number, read: (handle: number) => T | null): T | null {
        const handle = this.kernel.symbols.OpenProcess(access, 0, pid);
        if (handle === null) {
            return null;
        }
        try {
            return read(handle as unknown as number);
        } finally {
            this.kernel.symbols.CloseHandle(handle);
        }
    }

    private pathOf(handle: number): string | null {
        const size = new Uint32Array([this.pathBuffer.byteLength / 2]);
        if (this.kernel.symbols.QueryFullProcessImageNameW(handle as never, 0, ptr(this.pathBuffer), ptr(size)) === 0) {
            return null;
        }
        return Buffer.from(this.pathBuffer.buffer, 0, size[0]! * 2).toString('utf16le');
    }

    /* The token's user as text, comparable within one run; null when the token refuses, as an elevated process does. */
    private sidOf(handle: number): string | null {
        const out = new BigUint64Array(1);
        if (this.advapi.symbols.OpenProcessToken(handle as never, TOKEN_QUERY, ptr(out)) === 0) {
            return null;
        }
        const token = Number(out[0]!);
        try {
            const size = new Uint32Array(1);
            if (this.advapi.symbols.GetTokenInformation(token as never, TOKEN_USER, ptr(this.tokenBuffer), this.tokenBuffer.byteLength, ptr(size)) === 0) {
                return null;
            }
            return sidTextOf(this.tokenBuffer, ptr(this.tokenBuffer));
        } finally {
            this.kernel.symbols.CloseHandle(token as never);
        }
    }

    /* The pid of the console host, with two flag bits below it; null without a console. */
    private consoleHostOf(handle: number): number | null {
        const value = new BigUint64Array(1);
        if (this.nt.symbols.NtQueryInformationProcess(handle as never, PROCESS_CONSOLE_HOST_PROCESS, ptr(value), 8, null) !== 0 || value[0] === 0n) {
            return null;
        }
        return Number(value[0]! & ~3n);
    }

    private commandLineText(handle: number): string | null {
        // A command line is at most 32767 UTF-16 units, behind the string's own header.
        const buffer = new Uint8Array(65536 + 16);
        const size = new Uint32Array(1);
        if (this.nt.symbols.NtQueryInformationProcess(handle as never, PROCESS_COMMAND_LINE_INFORMATION, ptr(buffer), buffer.byteLength, ptr(size)) !== 0) {
            return null;
        }
        return unicodeString(buffer, new DataView(buffer.buffer), 0, ptr(buffer));
    }

    /* From the process's own memory: Windows has no call for another process's environment. Empty when it refuses. */
    private environmentOf(handle: number): Record<string, string> {
        const basic = new BigUint64Array(6);
        if (this.nt.symbols.NtQueryInformationProcess(handle as never, PROCESS_BASIC_INFORMATION, ptr(basic), basic.byteLength, null) !== 0) {
            return {};
        }
        const peb = basic[1]!;
        const parameters = this.readPointer(handle, peb + BigInt(PEB_PROCESS_PARAMETERS));
        if (parameters === null) {
            return {};
        }
        const address = this.readPointer(handle, parameters + BigInt(PARAMETERS_ENVIRONMENT));
        const size = this.readPointer(handle, parameters + BigInt(PARAMETERS_ENVIRONMENT_SIZE));
        if (address === null || size === null || size === 0n || size > BigInt(MAX_ENVIRONMENT_BYTES)) {
            return {};
        }
        const block = new Uint8Array(Number(size));
        if (this.kernel.symbols.ReadProcessMemory(handle as never, address, ptr(block), size, null) === 0) {
            return {};
        }
        return parseEnvironment(parseEnvironmentBlock(block));
    }

    private readPointer(handle: number, address: bigint): bigint | null {
        const value = new BigUint64Array(1);
        return this.kernel.symbols.ReadProcessMemory(handle as never, address, ptr(value), 8n, null) === 0 ? null : value[0]!;
    }
}

/* The SID of a `TOKEN_USER`: its pointer leads into the same buffer, and its length follows from its count of sub-authorities. */
export function sidTextOf(bytes: Uint8Array, base: number): string {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = Number(view.getBigUint64(0, true)) - base;
    const length = 8 + bytes[start + 1]! * 4;
    return Buffer.from(bytes.subarray(start, start + length)).toString('hex');
}

/* A block of UTF-16 `NAME=value` strings, closed by a double zero. */
export function parseEnvironmentBlock(block: Uint8Array): string[] {
    const text = Buffer.from(block.buffer, block.byteOffset, block.byteLength).toString('utf16le');
    const end = text.indexOf('\0\0');
    return (end === -1 ? text : text.slice(0, end)).split('\0').filter((entry) => entry !== '');
}

export class WindowsListenerProbe implements ListenerProbe {
    private readonly api = dlopen('iphlpapi.dll', {
        GetExtendedTcpTable: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u32 }
    });

    async read(pids: number[], signal: AbortSignal, port?: number): Promise<TcpListener[]> {
        if (pids.length === 0 || pids.length > 2048) {
            throw new Error('Listener scan exceeds its process budget');
        }
        signal.throwIfAborted();
        // Every owner of the destination, including processes outside the session tree, as on macOS.
        const listeners = [...parseTcpTable(this.table(AF_INET), 'ipv4'), ...parseTcpTable(this.table(AF_INET6), 'ipv6')];
        return port === undefined ? listeners : listeners.filter((listener) => listener.port === port);
    }

    private table(family: number): Uint8Array {
        let buffer = new Uint8Array(64 * 1024);
        const size = new Uint32Array(1);
        while (true) {
            size[0] = buffer.byteLength;
            const status = this.api.symbols.GetExtendedTcpTable(ptr(buffer), ptr(size), 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
            if (status === 0) {
                return buffer;
            }
            if (status !== ERROR_INSUFFICIENT_BUFFER) {
                throw new Error(`GetExtendedTcpTable answered ${status}`);
            }
            buffer = new Uint8Array(size[0]! + 4096);
        }
    }
}
