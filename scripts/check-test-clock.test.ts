import { describe, expect, test } from 'bun:test';
import { clockReads, processStarts } from './check-test-clock.ts';

function whatIn(text: string): string[] {
    return clockReads('example.test.ts', text).map((read) => read.what);
}

describe('clockReads', () => {
    test('finds every read of the wall clock, called or handed on', () => {
        const text = [
            'const a = Date.now();',
            'const b = { now: Date.now };',
            'const c = performance.now();',
            'const d = process.hrtime.bigint();',
            'const e = new Date();',
            'const f = Date();'
        ].join('\n');
        expect(clockReads('example.test.ts', text)).toEqual([
            { line: 1, what: 'Date.now' },
            { line: 2, what: 'Date.now' },
            { line: 3, what: 'performance.now' },
            { line: 4, what: 'process.hrtime' },
            { line: 5, what: 'new Date()' },
            { line: 6, what: 'Date()' }
        ]);
    });

    test('a fixed moment reads no clock', () => {
        expect(whatIn('const a = new Date(0); const b = Date.UTC(2026, 9, 1); const c = new Date("2026-10-01");')).toEqual([]);
    });

    test('lets the clock through as what a fake clock or a system time is set up with', () => {
        const text = [
            'setSystemTime(new Date());',
            'jest.useFakeTimers({ now: Date.now() });',
            'const clock = new ManualClock(Date.now());',
            'const other = fakeClock(performance.now());'
        ].join('\n');
        expect(whatIn(text)).toEqual([]);
    });

    test('a setup only covers its own arguments', () => {
        expect(whatIn('setSystemTime(new Date(0)); const late = Date.now();')).toEqual(['Date.now']);
    });
});

function startsIn(text: string): string[] {
    return processStarts('example.test.ts', text).map((started) => started.what);
}

describe('processStarts', () => {
    test('finds every way a test starts a process itself', () => {
        const text = [
            "import { execFileSync } from 'node:child_process';",
            "import { spawn as start, $ } from 'bun';",
            "const child = require('child_process');",
            "const later = await import('node:child_process');",
            "await Bun.spawn(['git', 'init']).exited;",
            "Bun.spawnSync(['ls']);",
            'await Bun.$`ls`;',
            "import { initRepo } from '../git/test-repo.ts';",
            "import { gitIn } from './test-repo';"
        ].join('\n');
        expect(processStarts('example.test.ts', text)).toEqual([
            { line: 1, what: 'node:child_process' },
            { line: 2, what: 'spawn from bun' },
            { line: 2, what: '$ from bun' },
            { line: 3, what: 'child_process' },
            { line: 4, what: 'node:child_process' },
            { line: 5, what: 'Bun.spawn' },
            { line: 6, what: 'Bun.spawnSync' },
            { line: 7, what: 'Bun.$' },
            { line: 8, what: '../git/test-repo.ts' },
            { line: 9, what: './test-repo' }
        ]);
    });

    test('a type, a fake and the rest of bun start nothing', () => {
        const text = [
            "import type { ChildProcess } from 'node:child_process';",
            "import type { RepoTemplate } from '../git/test-repo.ts';",
            "import { type Subprocess, Glob } from 'bun';",
            "spyOn(Bun, 'spawn').mockImplementation(fakeSpawn);",
            "const listed = new Glob('*.ts');"
        ].join('\n');
        expect(startsIn(text)).toEqual([]);
    });
});
