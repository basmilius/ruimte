/*
 * Timings of the model on 1, 10 and 25 MiB of source and on one 4 MiB line, one JSON line each.
 * Run with `bun scripts/benchmark.ts`, or `bun --expose-gc scripts/benchmark.ts` for heap figures.
 * Wall-clock numbers, so it stays out of the test run.
 */
import { DocumentModel } from '../src/index.ts';

const megabyte = 1024 * 1024;
const line = '\tconst item = { value: 123, name: "entry" }; // indexed document benchmark\r\n';
const collect = (globalThis as { gc?: () => void }).gc;

function measure(operation: () => void): number {
    const started = performance.now();
    operation();
    return performance.now() - started;
}

function rounded(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function heapUsed(): number {
    return process.memoryUsage().heapUsed;
}

function expectEqual(actual: number, expected: number, what: string): void {
    if (actual !== expected) {
        throw new Error(`${what}: expected ${expected}, got ${actual}.`);
    }
}

function benchmarkSource(sizeMiB: number): void {
    collect?.();
    let text = line.repeat(Math.ceil((sizeMiB * megabyte) / line.length));
    const heapBefore = heapUsed();
    let model!: DocumentModel;
    const constructMs = measure(() => {
        model = new DocumentModel(text);
    });
    const length = model.getLength();
    const lines = model.getLineCount();
    text = '';
    const buildHeap = heapUsed() - heapBefore;
    let checksum = 0;

    const queryMs = measure(() => {
        for (let index = 0; index < 10000; index++) {
            const position = model.positionAt((index * 7919) % length);
            checksum += model.offsetAt(position) + model.getLine(position.line).text.length;
        }
    });
    model.subscribe((snapshot) => {
        checksum += snapshot.revision;
    });
    const cursorMs = measure(() => {
        for (let index = 0; index < 10000; index++) {
            const offset = (index * 7919) % length;
            model.setSelections([{ anchor: offset, head: offset }]);
        }
    });

    collect?.();
    const heapBeforeEdits = heapUsed();
    const editTimes: number[] = [];
    for (let index = 0; index < 1000; index++) {
        const from = model.getLine((index * 7919) % (lines - 1)).start + 1;
        editTimes.push(
            measure(() => {
                model.applyEdits([{ from, to: from, text: 'x' }]);
            })
        );
    }
    collect?.();
    const historyHeap = heapUsed() - heapBeforeEdits;

    const historyMs = measure(() => {
        for (let index = 0; index < 200; index++) {
            model.undo();
        }
        for (let index = 0; index < 200; index++) {
            model.redo();
        }
    });
    const flattenMs = measure(() => {
        checksum += model.getSnapshot().text.length;
    });
    const searchMs = measure(() => {
        checksum += model.find('entry').length;
    });
    const foldMs = measure(() => {
        checksum += model.getFoldingRanges().length;
    });

    expectEqual(model.getLength(), length + 1000, 'length after the edits');
    expectEqual(model.getLineCount(), lines, 'line count after the edits');
    expectEqual(model.getRevision(), 1400, 'revision');
    editTimes.sort((left, right) => left - right);
    console.log(
        JSON.stringify({
            sizeMiB,
            length,
            lines,
            constructMs: rounded(constructMs),
            buildHeapMiB: rounded(buildHeap / megabyte),
            query10000Ms: rounded(queryMs),
            cursor10000Ms: rounded(cursorMs),
            editMedianMs: rounded(editTimes[500]!),
            editP95Ms: rounded(editTimes[950]!),
            edit1000Ms: rounded(editTimes.reduce((sum, time) => sum + time, 0)),
            history200UndoRedoMs: rounded(historyMs),
            historyHeapMiB: rounded(historyHeap / megabyte),
            flattenMs: rounded(flattenMs),
            searchMs: rounded(searchMs),
            foldMs: rounded(foldMs),
            checksum
        })
    );
}

function benchmarkLongLine(): void {
    const model = new DocumentModel('a'.repeat(4 * megabyte));
    const readMs = measure(() => {
        model.getLine(0);
    });
    const wordMs = measure(() => {
        model.execute('wordRight');
    });
    console.log(JSON.stringify({ longLineMiB: 4, longLineReadMs: rounded(readMs), longWordMs: rounded(wordMs) }));
}

console.log(
    JSON.stringify({
        runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`,
        platform: process.platform,
        architecture: process.arch,
        forcedGC: Boolean(collect)
    })
);
for (const sizeMiB of [1, 10, 25]) {
    benchmarkSource(sizeMiB);
}
benchmarkLongLine();
