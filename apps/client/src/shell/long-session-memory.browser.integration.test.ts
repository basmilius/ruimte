import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { clientDirectory, frame, withBrowserFixture } from '../../testing/browser-fixture';

/*
 * The workspace renderer ran out of memory after hours of work. Each test replays one kind of that work
 * in rounds against a fake machine, while what is on screen stays the same size, and weighs the page
 * after a full collection. The bounds leave room for the code V8 compiles as it goes, about 0.3 MB a
 * round, and fail on what a round left behind before: 0.4 MB of queued state updates per 2000 lines of
 * output, and 2 MB of scrollback per closed terminal.
 */

type View = InstanceType<typeof Bun.WebView>;

interface Sample {
    /* The JS heap. */
    heap: number;
    /* Blink's own heap, where the DOM lives. */
    blink: number;
    /* The backing stores of ArrayBuffers, which PartitionAlloc holds outside the JS heap. */
    buffers: number;
    nodes: number;
    listeners: number;
}

const MB = 1024 * 1024;

async function settle(view: View): Promise<void> {
    for (let index = 0; index < 4; index++) {
        await view.evaluate(frame);
    }
}

/* Waits frame by frame until `condition` holds in the page, for what lands a few renders later (a view shown). */
async function until(view: View, condition: string): Promise<void> {
    for (let index = 0; index < 100; index++) {
        if (await view.evaluate<boolean>(condition)) {
            return;
        }
        await view.evaluate(frame);
    }
    throw new Error(`never held: ${condition}`);
}

async function weigh(view: View): Promise<Sample> {
    await settle(view);
    // Twice, so what a finalizer of the first pass let go is collected as well.
    await view.cdp('HeapProfiler.collectGarbage');
    await view.cdp('HeapProfiler.collectGarbage');
    const heap = await view.cdp<{ usedSize: number; embedderHeapUsedSize: number; backingStorageSize: number }>('Runtime.getHeapUsage');
    const counters = await view.cdp<{ nodes: number; jsEventListeners: number }>('Memory.getDOMCounters');

    return {
        heap: heap.usedSize,
        blink: heap.embedderHeapUsedSize,
        buffers: heap.backingStorageSize,
        nodes: counters.nodes,
        listeners: counters.jsEventListeners
    };
}

/* Runs `round` as many times in a window of the workspace, and weighs the page after each. */
async function replay(rounds: number, round: (view: View) => Promise<void>): Promise<Sample[]> {
    const assets = join(clientDirectory, 'dist/assets');
    const sheets = (await readdir(assets)).filter((name) => name.endsWith('.css'));
    const styles = (await Promise.all(sheets.map((name) => readFile(join(assets, name), 'utf8')))).join('\n');
    const samples: Sample[] = [];

    await withBrowserFixture(
        `await import(${JSON.stringify(join(clientDirectory, 'testing/long-session.fixture.tsx'))});`,
        `${styles}html,body,#root{width:1400px;height:900px}`,
        async (view) => {
            await view.resize(1400, 900);
            await settle(view);

            for (let index = 0; index < rounds; index++) {
                await round(view);
                samples.push(await weigh(view));
            }

            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );

    if (process.env.LONG_SESSION_LOG === '1') {
        console.log(JSON.stringify(samples.map((sample) => [sample.heap, sample.blink, sample.buffers].map((bytes) => Math.round(bytes / 1024)))));
    }

    return samples;
}

/* What the page gained from `from` on, once the first rounds filled what is meant to fill. */
function growth(samples: readonly Sample[], from: number): Sample {
    const first = samples[from]!;
    const last = samples.at(-1)!;

    return {
        heap: last.heap - first.heap,
        blink: last.blink - first.blink,
        buffers: last.buffers - first.buffers,
        nodes: last.nodes - first.nodes,
        listeners: last.listeners - first.listeners
    };
}

describe('a long session', () => {
    test('output into an open terminal holds nothing more once its scrollback is full', async () => {
        // 2000 lines a round fill the 5000 lines of scrollback by the third.
        const samples = await replay(10, async (view) => {
            await view.evaluate('window.longSession.terminalOutput(window.longSession.shell, 2000)');
        });
        const gained = growth(samples, 4);

        expect(gained.heap).toBeLessThan(1.5 * MB);
        expect(gained.buffers).toBeLessThan(1 * MB);
        expect(gained.nodes).toBeLessThan(100);
        expect(gained.listeners).toBeLessThan(20);
    }, 120_000);

    test('terminals and chats that were opened, worked in and closed leave nothing behind', async () => {
        let screens = -1;
        const samples = await replay(10, async (view) => {
            await view.evaluate('window.longSession.openNodes()');
            await settle(view);
            await view.evaluate(`(() => {
                const session = window.longSession;
                for (const id of session.nodeIds('chat')) {
                    for (let turn = 1; turn <= 3; turn++) {
                        session.streamTurn(id, turn, 6, 40);
                    }
                }
                for (const id of session.nodeIds('terminal')) {
                    session.terminalOutput(id, 1000);
                }
            })()`);
            await settle(view);
            await view.evaluate('window.longSession.closeOpened()');
            await settle(view);
            screens = await view.evaluate<number>('window.longSession.screensOfClosed()');
        });
        const gained = growth(samples, 2);

        expect(screens).toBe(0);
        expect(gained.heap).toBeLessThan(6 * MB);
        expect(gained.buffers).toBeLessThan(1 * MB);
        // The count moves by about 260 nodes from one round to the next without growing.
        expect(gained.nodes).toBeLessThan(500);
        expect(gained.listeners).toBeLessThan(100);
    }, 120_000);

    test('a terminal out of sight keeps its last lines, not its scrollback', async () => {
        const kept: number[] = [];
        let round = 0;
        const samples = await replay(2, async (view) => {
            await view.evaluate(`window.longSession.show('main')`);
            await until(view, 'window.longSession.shellMounted()');
            // The first round weighs the shell out of sight with a screen of output, the second with full scrollback.
            await view.evaluate(`window.longSession.terminalOutput(window.longSession.shell, ${round === 0 ? 20 : 6000})`);
            await settle(view);
            await view.evaluate(`window.longSession.show('elsewhere')`);
            await until(view, '!window.longSession.shellMounted()');
            kept.push(await view.evaluate<number>('window.longSession.linesOfShell()'));
            round += 1;
        });
        const gained = growth(samples, 0);

        expect(kept[1]).toBe(200);
        // Its 5000 lines of scrollback, kept as strings, weighed 5.7 MB more here; 200 lines weigh 1.7 MB, most of it code compiled on the way.
        expect(gained.heap).toBeLessThan(3 * MB);
    }, 120_000);
});
