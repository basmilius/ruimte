import { describe, expect, test } from 'bun:test';
import {
    consoleRoots,
    fileTimeToMicros,
    parseCommandLine,
    parseEnvironmentBlock,
    parseProcessTable,
    parseTcpTable,
    settledParent,
    sidTextOf
} from './windows.ts';

const ENTRY_SIZE = 256;
const BASE = 0x10000;

interface Row {
    pid: number;
    ppid: number;
    name: string;
    createTime?: bigint;
}

/* A `SYSTEM_PROCESS_INFORMATION` chain as the kernel lays it out, each name behind its entry. */
function processTable(rows: Row[]): Uint8Array {
    const names = rows.map((row) => Buffer.from(row.name, 'utf16le'));
    const bytes = new Uint8Array(rows.length * ENTRY_SIZE + names.reduce((sum, name) => sum + name.length, 0));
    const view = new DataView(bytes.buffer);
    let nameOffset = rows.length * ENTRY_SIZE;
    rows.forEach((row, i) => {
        const at = i * ENTRY_SIZE;
        const name = names[i]!;
        view.setUint32(at, i === rows.length - 1 ? 0 : ENTRY_SIZE, true);
        view.setBigInt64(at + 8, 4096n, true);
        view.setBigInt64(at + 32, row.createTime ?? 133000000000000000n, true);
        view.setBigInt64(at + 40, 10n, true);
        view.setBigInt64(at + 48, 5n, true);
        view.setUint16(at + 56, name.length, true);
        view.setUint16(at + 58, name.length, true);
        view.setBigUint64(at + 64, BigInt(name.length === 0 ? 0 : BASE + nameOffset), true);
        view.setBigUint64(at + 80, BigInt(row.pid), true);
        view.setBigUint64(at + 88, BigInt(row.ppid), true);
        view.setBigInt64(at + 232, 700n, true);
        view.setBigInt64(at + 240, 800n, true);
        bytes.set(name, nameOffset);
        nameOffset += name.length;
    });
    return bytes;
}

describe('parseProcessTable', () => {
    test('reads every entry, drops the idle count and the .exe', () => {
        const table = processTable([
            { pid: 0, ppid: 0, name: '' },
            { pid: 4, ppid: 0, name: 'System' },
            { pid: 1200, ppid: 4, name: 'Bash.EXE' }
        ]);
        expect(parseProcessTable(table, BASE)).toEqual([
            { pid: 4, ppid: 0, startTime: 1655526400000000, name: 'System', cpuNs: 1500, memory: 4096, diskRead: 700, diskWrite: 800 },
            { pid: 1200, ppid: 4, startTime: 1655526400000000, name: 'Bash', cpuNs: 1500, memory: 4096, diskRead: 700, diskWrite: 800 }
        ]);
    });
});

describe('fileTimeToMicros', () => {
    test('counts from the Unix epoch, and no time stays 0', () => {
        expect(fileTimeToMicros(116444736000000000n + 15n)).toBe(1);
        expect(fileTimeToMicros(0n)).toBe(0);
    });
});

describe('settledParent', () => {
    test('a live, older parent stands', () => {
        expect(settledParent({ ppid: 9, startTime: 200 }, { startTime: 100 })).toBe(9);
    });

    test('a parent that ended or whose pid was reused counts as an orphan, as POSIX has it', () => {
        expect(settledParent({ ppid: 9, startTime: 200 }, undefined)).toBe(1);
        expect(settledParent({ ppid: 9, startTime: 200 }, { startTime: 300 })).toBe(1);
    });
});

describe('consoleRoots', () => {
    test('the oldest process on a console is its root; a process without one counts for nothing', () => {
        const roots = consoleRoots([
            { pid: 30, startTime: 300, consoleHost: 8 },
            { pid: 10, startTime: 100, consoleHost: 8 },
            { pid: 20, startTime: 50, consoleHost: null },
            { pid: 40, startTime: 400, consoleHost: 9 }
        ]);
        expect(roots.get(8)?.pid).toBe(10);
        expect(roots.get(9)?.pid).toBe(40);
        expect(roots.size).toBe(2);
    });
});

describe('parseCommandLine', () => {
    test.each([
        ['a b  c', ['a', 'b', 'c']],
        ['"C:\\Program Files\\x.exe" -p "a b"', ['C:\\Program Files\\x.exe', '-p', 'a b']],
        ['a\\\\b\\c', ['a\\\\b\\c']],
        ['"a\\\\" b', ['a\\', 'b']],
        ['a\\"b', ['a"b']],
        ['a\\\\\\"b', ['a\\"b']],
        ['"a""b"', ['a"b']],
        ['"" x', ['', 'x']],
        ['', []]
    ])('%s', (line, args) => {
        expect(parseCommandLine(line)).toEqual(args);
    });
});

describe('parseTcpTable', () => {
    test('reads IPv4 rows, with the port in network order', () => {
        const bytes = new Uint8Array(4 + 24 * 2);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 2, true);
        bytes.set([127, 0, 0, 1], 4 + 4);
        view.setUint16(4 + 8, 3000, false);
        view.setUint32(4 + 20, 111, true);
        view.setUint16(28 + 8, 80, false);
        view.setUint32(28 + 20, 222, true);
        expect(parseTcpTable(bytes, 'ipv4')).toEqual([
            { pid: 111, port: 3000, host: '127.0.0.1', bindAddress: '127.0.0.1' },
            { pid: 222, port: 80, host: '127.0.0.1', bindAddress: '0.0.0.0' }
        ]);
    });

    test('reads IPv6 rows and writes the addresses the port check recognizes', () => {
        const addresses: [number[], string][] = [
            [new Array(16).fill(0), '[::]'],
            [[...new Array(15).fill(0), 1], '[::1]'],
            [[...new Array(10).fill(0), 0xff, 0xff, 127, 0, 0, 1], '[::ffff:127.0.0.1]'],
            [[0xfe, 0x80, ...new Array(12).fill(0), 0xab, 0xcd], '[fe80::abcd]']
        ];
        const bytes = new Uint8Array(4 + 56 * addresses.length);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, addresses.length, true);
        addresses.forEach(([address], i) => {
            const at = 4 + i * 56;
            bytes.set(address, at);
            view.setUint16(at + 20, 5173, false);
            view.setUint32(at + 52, 7, true);
        });
        expect(parseTcpTable(bytes, 'ipv6')).toEqual(addresses.map(([, bindAddress]) => ({ pid: 7, port: 5173, host: '[::1]', bindAddress })));
    });
});

describe('sidTextOf', () => {
    test('takes exactly the SID the pointer leads to', () => {
        const bytes = new Uint8Array(64).fill(0xee);
        new DataView(bytes.buffer).setBigUint64(0, BigInt(BASE + 16), true);
        bytes.set([1, 2, 0, 0, 0, 0, 0, 5, 1, 0, 0, 0, 2, 0, 0, 0], 16);
        expect(sidTextOf(bytes, BASE)).toBe('01020000000000050100000002000000');
    });
});

describe('parseEnvironmentBlock', () => {
    test('stops at the double zero', () => {
        const block = Buffer.from('A=1\0=C:=C:\\x\0B=two\0\0junk', 'utf16le');
        expect(parseEnvironmentBlock(block)).toEqual(['A=1', '=C:=C:\\x', 'B=two']);
    });
});
