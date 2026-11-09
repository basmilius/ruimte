import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/*
 * Builds the measurement and runs it against Electron once per round trip time.
 *
 *   bun scripts/measure-port-bridge/run.ts --electron /path/to/Electron --rtt 0,100 --runs 3
 *
 * `--electron` is the Electron binary of a checkout that installed it. The fake machine is the real dispatcher,
 * grants and streams of the daemon behind a WebSocket on loopback (`machine.ts`), so what is measured is the
 * path inside the desktop app plus the daemon's side of the wire, and no network.
 */
const { values } = parseArgs({
    options: {
        electron: { type: 'string' },
        rtt: { type: 'string', default: '0,100' },
        runs: { type: 'string', default: '3' },
        mb: { type: 'string', default: '8' }
    }
});

if (values.electron === undefined) {
    throw new Error('Pass --electron with the path of the Electron binary');
}

const here = import.meta.dir;
const out = join(tmpdir(), `port-bridge-${Date.now()}`);

mkdirSync(out, { recursive: true });
copyFileSync(join(here, 'relay.html'), join(out, 'relay.html'));

for (const [entry, target, name] of [
    ['main.ts', 'node', 'main.cjs'],
    ['preload.ts', 'node', 'preload.cjs'],
    ['relay-page.ts', 'browser', 'relay-page.js']
] as const) {
    const built = await Bun.build({
        entrypoints: [join(here, entry)],
        target,
        format: target === 'node' ? 'cjs' : 'iife',
        external: ['electron'],
        conditions: ['source'],
        outdir: out,
        naming: name
    });

    if (!built.success) {
        throw new Error(built.logs.join('\n'));
    }
}

const table: string[][] = [];

for (const rtt of values.rtt!.split(',')) {
    const machine = Bun.spawn(['bun', join(here, 'machine.ts'), '--rtt', rtt], { stdout: 'pipe', stderr: 'inherit' });
    const reader = machine.stdout.getReader();
    const ready = new TextDecoder().decode((await reader.read()).value);
    const port = /READY (\d+)/.exec(ready)?.[1];

    if (port === undefined) {
        machine.kill();
        throw new Error(`The machine did not start: ${ready}`);
    }

    const resultFile = join(out, `result-${rtt}.json`);
    const electron = Bun.spawn([values.electron, join(out, 'main.cjs')], {
        env: { ...process.env, MACHINE_URL: `ws://127.0.0.1:${port}`, RESULT_FILE: resultFile, HARNESS_DIR: out, RUNS: values.runs!, BIG_MB: values.mb! },
        stdout: 'inherit',
        stderr: 'inherit'
    });

    await electron.exited;
    machine.kill();

    const rows = JSON.parse(readFileSync(resultFile, 'utf8')) as Array<Record<string, number | string>>;

    const alone = rows.find((row) => row.kind === 'ipc-only');

    if (alone !== undefined) {
        const { kind: _kind, ...numbers } = alone;

        console.log(`one IPC hop alone, ${rtt} ms run: ${JSON.stringify(numbers)}`);
    }

    for (const kind of ['baseline', 'bridge', 'protocol']) {
        const mine = rows.filter((row) => row.kind === kind);
        const median = (key: string): string => {
            const numbers = mine
                .map((row) => row[key])
                .filter((value): value is number => typeof value === 'number')
                .sort((a, b) => a - b);

            return numbers.length === 0 ? String(mine[0]?.[key] ?? mine[0]?.error ?? '-') : String(numbers[Math.floor(numbers.length / 2)]);
        };
        const bigMb = Number(values.mb);
        const bigMs = Number(median('bigMs'));

        table.push([
            `${rtt} ms`,
            kind,
            median('ttfbMs'),
            median('smallMs'),
            median('bigMs'),
            Number.isFinite(bigMs) && bigMs > 0 ? (bigMb / (bigMs / 1000)).toFixed(1) : '-',
            median('upMs'),
            median('ws'),
            `${median('leakedToLocalLoopback')} / ${median('siteAuthStatus')} / ${median('proxyHeadersSeenBySite')}`,
            median('peakMainRssMb'),
            median('peakAllWorkingSetMb')
        ]);
    }
}

const header = [
    'RTT',
    'path',
    'TTFB ms',
    '200 small ms',
    `${values.mb} MiB ms`,
    'MiB/s',
    '2 MiB up ms',
    'ws first msg ms',
    'leaks / site 401 / proxy headers at site',
    'peak main RSS MB',
    'peak all MB'
];

console.log([header, header.map(() => '---'), ...table].map((row) => `| ${row.join(' | ')} |`).join('\n'));
console.log(`\nraw: ${out}`);
