import { strict as assert } from 'node:assert';
import { Terminal } from '@xterm/headless';
import { trackOutputCwd } from '../../client/src/terminal/output-cwd';

type Metadata = 'none' | 'fixed' | 'changing';
type Workload = 'burst' | 'chunks';
interface Sample {
    tracked: boolean;
    milliseconds: number;
    prefillMilliseconds: number;
    markers: number;
    bufferLines: number;
}

const rows = 50_000;
const columns = 80;
const viewportRows = 24;
const scrollback = 5_000;
const prefillRows = 6_000;
const chunkRows = 128;
const argumentsList = process.argv.slice(2);
const repetitions = integerOption('repetitions', 3, 3);
const warmup = integerOption('warmup', 1, 1);
const metadataOption = argumentsList.find((argument) => argument.startsWith('--metadata='))?.slice('--metadata='.length) ?? 'none,fixed';
const metadataModes = metadataOption.split(',') as Metadata[];
const enforce = argumentsList.includes('--enforce');
assert(metadataModes.length > 0 && metadataModes.every((mode) => ['none', 'fixed', 'changing'].includes(mode)), 'Invalid --metadata list');
for (const argument of argumentsList) {
    assert(argument === '--enforce' || /^--(?:repetitions|warmup|metadata)=/.test(argument), `Unknown argument: ${argument}`);
}

console.log(
    JSON.stringify({
        environment: { bun: Bun.version, platform: process.platform, architecture: process.arch },
        rows,
        columns,
        viewportRows,
        scrollback,
        prefillRows,
        chunkRows,
        warmup,
        repetitions,
        metadataModes,
        // A fixed allowance keeps tiny parser baselines from turning timer noise into large ratios.
        budget: { multiplier: 2, extraMilliseconds: 150 },
        enforced: enforce
    })
);

let exceeded = false;
for (const metadata of metadataModes) {
    const prefill = makeOutput(prefillRows, metadata);
    const output = makeOutput(rows, metadata);
    for (const workload of ['burst', 'chunks'] as const) {
        const plain: Sample[] = [];
        const tracked: Sample[] = [];
        for (let iteration = 0; iteration < warmup + repetitions; iteration++) {
            // Alternating order reduces the advantage of running after JIT warmup or a quieter interval.
            const order = iteration % 2 === 0 ? [false, true] : [true, false];
            for (const tracking of order) {
                const sample = await measure(metadata, workload, tracking, prefill, output);
                if (iteration >= warmup) {
                    (tracking ? tracked : plain).push(sample);
                }
                console.log(JSON.stringify({ phase: iteration < warmup ? 'warmup' : 'sample', metadata, workload, iteration, ...sample }));
            }
        }
        const plainMedian = median(plain.map((sample) => sample.milliseconds));
        const trackedMedian = median(tracked.map((sample) => sample.milliseconds));
        const limit = plainMedian * 2 + 150;
        const passed = trackedMedian <= limit;
        exceeded ||= !passed;
        console.log(
            JSON.stringify({
                result: { metadata, workload, plainMedian, trackedMedian, overhead: trackedMedian - plainMedian, limit, passed },
                plain,
                tracked
            })
        );
    }
}
if (enforce && exceeded) {
    process.exitCode = 1;
}

function integerOption(name: string, fallback: number, minimum: number): number {
    const argument = argumentsList.find((value) => value.startsWith(`--${name}=`));
    const value = argument === undefined ? fallback : Number(argument.slice(name.length + 3));
    assert(Number.isSafeInteger(value) && value >= minimum && value <= 20, `--${name} must be an integer from ${minimum} to 20`);
    return value;
}

function cwdFor(index: number, metadata: Metadata): string | null {
    if (metadata === 'none') {
        return null;
    }
    return metadata === 'fixed' || Math.floor(index / 250) % 2 === 0 ? '/repo/a' : '/repo/b';
}

function makeOutput(count: number, metadata: Metadata): string[] {
    return Array.from({ length: count }, (_, index) => {
        const cwd = cwdFor(index, metadata);
        const announce = cwd !== null && (index === 0 || (metadata === 'changing' && index % 250 === 0));
        return `${announce ? `\x1b]7;file://fixture${cwd}\x07` : ''}${String(index).padStart(5, '0')} ordinary terminal output\r\n`;
    });
}

function write(term: Terminal, data: string): Promise<void> {
    return new Promise((resolve) => term.write(data, resolve));
}

async function measure(metadata: Metadata, workload: Workload, tracked: boolean, prefill: string[], output: string[]): Promise<Sample> {
    const term = new Terminal({ cols: columns, rows: viewportRows, scrollback, allowProposedApi: true });
    // Headless shares xterm's parser, buffer and marker API; the consumer type also has DOM methods.
    const cwd = tracked ? trackOutputCwd(term as unknown as Parameters<typeof trackOutputCwd>[0]) : null;
    try {
        const beforePrefill = performance.now();
        await write(term, prefill.join(''));
        const prefillMilliseconds = performance.now() - beforePrefill;
        assert.equal(term.buffer.active.baseY, scrollback, 'Scrollback must be full before measurement');
        const started = performance.now();
        if (workload === 'burst') {
            await write(term, output.join(''));
        } else {
            for (let index = 0; index < output.length; index += chunkRows) {
                await write(term, output.slice(index, index + chunkRows).join(''));
            }
        }
        const milliseconds = performance.now() - started;
        const lastOutputRow = term.buffer.active.baseY + term.buffer.active.cursorY - 1;
        assert.equal(term.buffer.active.getLine(lastOutputRow)?.translateToString(true), '49999 ordinary terminal output');
        assert.equal(term.buffer.active.length, scrollback + viewportRows);
        if (cwd) {
            assert.equal(cwd.at(lastOutputRow + 1), cwdFor(rows - 1, metadata), 'Tracking must retain usable context, not just bypass its work');
        }
        const markers = term.markers.length;
        assert(markers <= scrollback + viewportRows + 64, 'Marker retention must be bounded by the retained output');
        return { tracked, milliseconds, prefillMilliseconds, markers, bufferLines: term.buffer.active.length };
    } finally {
        cwd?.dispose();
        term.dispose();
    }
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}
