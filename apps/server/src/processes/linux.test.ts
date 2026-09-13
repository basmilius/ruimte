import { describe, expect, test } from 'bun:test';
import { parseCpuLine, parseKeyValues, parseStat } from './linux.ts';

describe('the /proc readers', () => {
    test('a name with spaces and parentheses does not shift the fields after it', () => {
        const text = '4242 (tmux: server (1)) S 1 4242 4242 0 -1 4194560 363 0 0 0 120 30 0 0 20 0 1 0 98765 12345678 900 18446744073709551615';
        expect(parseStat(text)).toEqual({ name: 'tmux: server (1)', ppid: 1, cpuTicks: 150, startTicks: 98765 });
    });

    test('status, io and meminfo lines give their first number', () => {
        const values = parseKeyValues('Name:\tbun\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t  51200 kB\nread_bytes: 4096\n');
        expect(values.get('Uid')).toBe(1000);
        expect(values.get('VmRSS')).toBe(51200);
        expect(values.get('read_bytes')).toBe(4096);
        expect(values.has('Name')).toBe(false);
    });

    test('busy CPU leaves idle and iowait out', () => {
        expect(parseCpuLine('cpu  100 5 50 800 20 3 2 0 0 0\ncpu0 1 2 3 4\n')).toEqual({ busy: 160, total: 980 });
    });
});
