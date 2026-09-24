import { describe, expect, test } from 'bun:test';
import { parseProcessTable, runsShells, type ProcessRow } from './terminal-apps.ts';

describe('the process table', () => {
    test('reads pid, parent and controlling terminal, with none for ??', () => {
        expect(parseProcessTable('  501     1 ??      \n  778   777 ttys004 \nPID PPID TTY\n\n')).toEqual([
            { pid: 501, ppid: 1, tty: null },
            { pid: 778, ppid: 777, tty: 'ttys004' }
        ]);
    });
});

describe('an app that runs shells', () => {
    test('is one whose own child has a terminal of its own', () => {
        const rows: ProcessRow[] = [
            { pid: 100, ppid: 1, tty: null },
            { pid: 101, ppid: 100, tty: 'ttys001' }
        ];
        expect(runsShells(100, rows)).toBe(true);
    });

    test('is one whose shells run under a pty host of its own, down to three levels', () => {
        const rows: ProcessRow[] = [
            { pid: 200, ppid: 1, tty: null },
            { pid: 201, ppid: 200, tty: null },
            { pid: 202, ppid: 201, tty: null },
            { pid: 203, ppid: 202, tty: 'ttys002' }
        ];
        expect(runsShells(200, rows)).toBe(true);
        expect(runsShells(200, rows.slice(0, 3))).toBe(false);
    });

    test('is not one whose only terminal sits deeper than three levels', () => {
        const rows: ProcessRow[] = [
            { pid: 200, ppid: 1, tty: null },
            { pid: 201, ppid: 200, tty: null },
            { pid: 202, ppid: 201, tty: null },
            { pid: 203, ppid: 202, tty: null },
            { pid: 204, ppid: 203, tty: 'ttys002' }
        ];
        expect(runsShells(200, rows)).toBe(false);
    });

    test('is not one started from a shell whose children share that shell’s terminal', () => {
        const rows: ProcessRow[] = [
            { pid: 300, ppid: 50, tty: 'ttys003' },
            { pid: 301, ppid: 300, tty: 'ttys003' },
            { pid: 302, ppid: 301, tty: 'ttys003' }
        ];
        expect(runsShells(300, rows)).toBe(false);
    });

    test('is one even when it was started from a shell itself, once its own shells have terminals of their own', () => {
        const rows: ProcessRow[] = [
            { pid: 400, ppid: 50, tty: 'ttys003' },
            { pid: 401, ppid: 400, tty: 'ttys007' }
        ];
        expect(runsShells(400, rows)).toBe(true);
    });
});
