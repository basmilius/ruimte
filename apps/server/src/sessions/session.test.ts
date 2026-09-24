import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import type { ServerFrame } from '@ruimte/contracts';
import { HIGH_WATER_MARK, OutputGate, type BackpressuredSocket } from '../backpressure.ts';
import type { SessionEvent } from './manager.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string) => harness.manager.create({ sessionId, cols: 80, rows: 24, shell: '/bin/sh', args: [], cwd: harness.home });

// Every character in a color of its own, so parsing a line costs enough that a burst outlasts one of xterm's write slices.
const colored = (text: string): string => [...text].map((character, i) => `\x1b[3${i % 8}m${character}`).join('') + '\x1b[0m';

/* Emits each line as a read of its own, so the emulator has a queue of writes to work through. */
const emitLines = (sessionId: string, from: number, to: number): string[] => {
    const pty = harness.adapter.forSession(sessionId);
    const lines: string[] = [];
    for (let i = from; i < to; i++) {
        const line = `line ${i} `.padEnd(70, '.');
        lines.push(line);
        pty.emit(`${colored(line)}\r\n`);
    }
    return lines;
};

type Step = { screen: string } | { output: string };

// RIS, as the client resets: in order with the writes still queued, which `Terminal.reset()` is not.
const FULL_RESET = '\x1bc';

/* What a client ends up showing: a screen replaces everything, output is written on top. */
const replay = async (steps: Step[]): Promise<string[]> => {
    const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 10_000, allowProposedApi: true });
    for (const step of steps) {
        terminal.write('screen' in step ? `${FULL_RESET}${step.screen}` : step.output);
    }
    await new Promise<void>((resolve) => terminal.write('', resolve));
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)?.translateToString(true) ?? '';
        if (line !== '') {
            lines.push(line);
        }
    }
    terminal.dispose();
    return lines;
};

describe('Session.snapshotFor', () => {
    test('output emitted while an attach takes its screen is in the screen or in the stream, exactly once', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');

        const lines = emitLines('s1', 0, 3000);
        const attaching = harness.manager.attach('s1', 'c1', 80, 24);
        lines.push(...emitLines('s1', 3000, 6000));
        const { screen } = await attaching;
        lines.push(...emitLines('s1', 6000, 7000));
        harness.manager.get('s1')!.flush();

        expect(await replay([{ screen }, { output: recorder.output }])).toEqual(lines);
    });

    test('a resync after dropped output repeats nothing the client was about to be sent', async () => {
        const frames: SessionEvent[] = [];
        const socket: BackpressuredSocket & { buffered: number } = {
            buffered: 0,
            send(data) {
                frames.push(JSON.parse(data) as SessionEvent);
                return 1;
            },
            getBufferedAmount() {
                return this.buffered;
            }
        };
        const gate = new OutputGate({
            socket,
            screenOf: (sessionId, deliver) => {
                const session = harness.manager.get(sessionId);
                if (!session?.isAttached('c1')) {
                    return false;
                }
                session.snapshotFor('c1', deliver);
                return true;
            }
        });
        harness.manager.subscribe('c1', ({ event, payload }) => gate.send({ type: 'event', event, payload } as ServerFrame));
        await create('s1');
        const session = harness.manager.get('s1')!;
        const { screen } = await harness.manager.attach('s1', 'c1', 80, 24);

        const lines = emitLines('s1', 0, 1);
        session.flush();
        socket.buffered = HIGH_WATER_MARK + 1;
        lines.push(...emitLines('s1', 1, 2));
        session.flush();
        lines.push(...emitLines('s1', 2, 3));
        session.flush();
        // Waiting for its tick when the socket drains: the screen holds it, so the stream must not.
        lines.push(...emitLines('s1', 3, 4));
        socket.buffered = 0;
        gate.onDrain();
        await session.serializeScreen();
        lines.push(...emitLines('s1', 4, 5));
        session.flush();

        const steps: Step[] = [{ screen }];
        for (const frame of frames) {
            if (frame.event === 'session.output') {
                steps.push({ output: frame.payload.data });
            } else if (frame.event === 'session.resync') {
                steps.push({ screen: frame.payload.screen });
            }
        }
        expect(steps.filter((step) => 'screen' in step)).toHaveLength(2);
        expect(await replay(steps)).toEqual(lines);
    });

    test('a second attach of the same client drops what the first one had buffered', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);

        const lines = emitLines('s1', 0, 10);
        const { screen } = await harness.manager.attach('s1', 'c1', 80, 24);
        lines.push(...emitLines('s1', 10, 20));
        harness.manager.get('s1')!.flush();

        expect(await replay([{ screen }, { output: recorder.output }])).toEqual(lines);
    });

    test('a screen still being taken when its session is disposed is handed over anyway', async () => {
        await create('s1');
        const session = harness.manager.get('s1')!;
        emitLines('s1', 0, 100);
        const screens: string[] = [];
        session.snapshotFor('c1', (screen) => screens.push(screen));
        const serialized = session.serializeScreen();

        session.dispose();

        expect(screens).toHaveLength(1);
        await expect(serialized).resolves.toBeString();
    });
});
