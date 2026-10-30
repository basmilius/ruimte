import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/headless';
import type { ServerFrame } from '@ruimte/contracts';
import { HIGH_WATER_MARK, OutputGate, type BackpressuredSocket } from '../backpressure.ts';
import { SCREEN_MAX_BYTES } from './fit-screen.ts';
import type { SessionEvent } from './manager.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

// A socket whose buffered amount a test sets, and the frames it was sent.
function recordingSocket() {
    const frames: ServerFrame[] = [];
    const socket: BackpressuredSocket & { buffered: number } = {
        buffered: 0,
        send(data) {
            frames.push(JSON.parse(String(data)) as ServerFrame);
            return 1;
        },
        getBufferedAmount() {
            return this.buffered;
        }
    };
    return { socket, frames };
}

// Every character in a color of its own, so parsing a line costs enough that a burst outlasts one of xterm's write slices.
function colored(text: string): string {
    return [...text].map((character, i) => `\x1b[3${i % 8}m${character}`).join('') + '\x1b[0m';
}

/* Emits each line as a read of its own, so the emulator has a queue of writes to work through. */
function emitLines(sessionId: string, from: number, to: number): string[] {
    const pty = harness.adapter.forSession(sessionId);
    const lines: string[] = [];
    for (let i = from; i < to; i++) {
        const line = `line ${i} `.padEnd(70, '.');
        lines.push(line);
        pty.emit(`${colored(line)}\r\n`);
    }
    return lines;
}

type Step = { screen: string } | { output: string };

// RIS, as the client resets: in order with the writes still queued, which `Terminal.reset()` is not.
const FULL_RESET = '\x1bc';

/* What a client ends up showing: a screen replaces everything, output is written on top. */
async function replay(steps: Step[]): Promise<string[]> {
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
}

describe('Session.snapshotFor', () => {
    test('output emitted while an attach takes its screen is in the screen or in the stream, exactly once', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');

        const lines = emitLines('s1', 0, 3000);
        const attaching = harness.manager.attach('s1', 'c1', 80, 24);
        lines.push(...emitLines('s1', 3000, 6000));
        const { screen } = await attaching;
        lines.push(...emitLines('s1', 6000, 7000));
        harness.manager.get('s1')!.flush();

        expect(await replay([{ screen }, { output: recorder.output }])).toEqual(lines);
    });

    test('a resync after dropped output repeats nothing the client was about to be sent', async () => {
        const { socket, frames } = recordingSocket();
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
        await harness.create('s1');
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
        for (const frame of frames as SessionEvent[]) {
            if (frame.event === 'session.output') {
                steps.push({ output: frame.payload.data });
            } else if (frame.event === 'session.resync') {
                steps.push({ screen: frame.payload.screen });
            }
        }
        expect(steps.filter((step) => 'screen' in step)).toHaveLength(2);
        expect(await replay(steps)).toEqual(lines);
    });

    test('output waiting for its share when the same client attaches again is in the new screen and not the stream', async () => {
        const { socket, frames } = recordingSocket();
        const share = { budget: 1_000, backlogChars: 1_000_000, sliceChars: 100 };
        const gate = new OutputGate({ socket, screenOf: () => false, share });
        harness.manager.subscribe('c1', ({ event, payload }) => gate.send({ type: 'event', event, payload } as ServerFrame));
        harness.manager.observeScreens('c1', (sessionId) => gate.screenTaken(sessionId));
        await harness.create('s1');
        const session = harness.manager.get('s1')!;
        const attach = async (id: string): Promise<void> => {
            const result = await harness.manager.attach('s1', 'c1', 80, 24);
            gate.send({ id, ok: true, result });
        };
        await attach('first');

        socket.buffered = share.budget;
        const lines = emitLines('s1', 0, 10);
        session.flush();
        expect(gate.waitingSessions()).toEqual(['s1']);
        await attach('second');
        expect(gate.waitingSessions()).toEqual([]);
        lines.push(...emitLines('s1', 10, 20));
        session.flush();
        socket.buffered = 0;
        gate.onDrain();

        const steps: Step[] = [];
        for (const frame of frames) {
            if ('ok' in frame && frame.ok) {
                steps.push({ screen: (frame.result as { screen: string }).screen });
            } else if ('event' in frame && frame.event === 'session.output') {
                steps.push({ output: (frame.payload as { data: string }).data });
            }
        }
        expect(await replay(steps)).toEqual(lines);
    });

    test('a second attach of the same client drops what the first one had buffered', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);

        const lines = emitLines('s1', 0, 10);
        const { screen } = await harness.manager.attach('s1', 'c1', 80, 24);
        // The new screen replaces output delivered before the second attach.
        recorder.events.length = 0;
        lines.push(...emitLines('s1', 10, 20));
        harness.manager.get('s1')!.flush();

        expect(await replay([{ screen }, { output: recorder.output }])).toEqual(lines);
    });

    test('a screen still being taken when its session is disposed is handed over anyway', async () => {
        await harness.create('s1');
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

describe('Session screens shared between clients', () => {
    test('clients that ask at the same moment share one serialization', async () => {
        await harness.create('s1');
        emitLines('s1', 0, 50);
        const serialize = spyOn(SerializeAddon.prototype, 'serialize');
        try {
            const attached = await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5'].map((clientId) => harness.manager.attach('s1', clientId, 80, 24)));
            expect(serialize).toHaveBeenCalledTimes(1);
            expect(new Set(attached.map(({ screen }) => screen)).size).toBe(1);

            serialize.mockClear();
            const resynced: string[] = [];
            await harness.manager.get('s1')!.clear((_, screen) => resynced.push(screen));
            expect(resynced).toHaveLength(5);
            expect(serialize).toHaveBeenCalledTimes(1);
        } finally {
            serialize.mockRestore();
        }
    });

    test('output between two asks gives each client a screen of its own, in step with its stream', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());
        await harness.create('s1');
        const lines = emitLines('s1', 0, 500);
        const serialize = spyOn(SerializeAddon.prototype, 'serialize');
        try {
            const attachingFirst = harness.manager.attach('s1', 'c1', 80, 24);
            const between = emitLines('s1', 500, 1000);
            const attachingSecond = harness.manager.attach('s1', 'c2', 80, 24);
            const after = emitLines('s1', 1000, 1500);
            const [{ screen: firstScreen }, { screen: secondScreen }] = await Promise.all([attachingFirst, attachingSecond]);
            harness.manager.get('s1')!.flush();

            expect(serialize).toHaveBeenCalledTimes(2);
            expect(firstScreen).not.toBe(secondScreen);
            const all = [...lines, ...between, ...after];
            expect(await replay([{ screen: firstScreen }, { output: first.output }])).toEqual(all);
            expect(await replay([{ screen: secondScreen }, { output: second.output }])).toEqual(all);
        } finally {
            serialize.mockRestore();
        }
    });
});

describe('Session.attach', () => {
    test('a client that comes back at another grid gets every line it left, through a snapshot pass and a resize', async () => {
        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 120, 30);
        const lines = emitLines('s1', 0, 60);
        await harness.manager.snapshotAll(true);
        harness.manager.detach('s1', 'c1');
        harness.manager.resize('s1', 100, 30);

        const { screen, cols, rows } = await harness.manager.attach('s1', 'c2', 72, 20);

        expect({ cols, rows }).toEqual({ cols: 72, rows: 20 });
        expect(await replay([{ screen }])).toEqual(lines);
    });

    test('a screen past what one frame carries comes back with its newest lines and under the limit', async () => {
        await harness.manager.create({ sessionId: 'art', cols: 160, rows: 50, shell: '/bin/sh', args: [], cwd: harness.home });
        const pty = harness.adapter.forSession('art');
        // What an image-to-ANSI tool prints: half blocks with a truecolor foreground and background per cell.
        for (let line = 0; line < 1000; line++) {
            let text = '';
            for (let col = 0; col < 160; col++) {
                text += `\x1b[38;2;${(line * 7 + col) % 256};${(col * 3) % 256};${line % 256}m\x1b[48;2;${(col * 5) % 256};${line % 256};${(line + col) % 256}m▀`;
            }
            pty.emit(`${text}\x1b[0m\r\n`);
        }
        pty.emit('the newest line\r\n');

        const { screen } = await harness.manager.attach('art', 'c1');

        expect(Buffer.byteLength(JSON.stringify(screen))).toBeLessThanOrEqual(SCREEN_MAX_BYTES);
        expect(screen).toContain('the newest line');
    });
});

describe('Session screens and character widths', () => {
    // A program that draws a frame moves to the border's column, so the cells after a wide character stay where it put them.
    const BORDER_COLUMN = '\x1b[30G\u2551';
    const WIDE_LINES = [
        '\u2554\u2550\u2550 \u65e5\u672c\u8a9e \u2550\u2550',
        'fire \u{1f525} heart \u2764\ufe0f',
        'family \u{1f468}\u200d\u{1f469}\u200d\u{1f467} \u{1f1f3}\u{1f1f1}',
        'ab\u6f22\u5b57cd \u{1f600}\u{1f600}',
        'rocket \u{1f680} ok'
    ].map((line) => `${line}${BORDER_COLUMN}`);

    interface Cells {
        rows: string[];
        cursor: { x: number; y: number };
    }

    function cellsOf(terminal: Terminal): Cells {
        const buffer = terminal.buffer.active;
        const rows: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
            rows.push(buffer.getLine(i)?.translateToString(true) ?? '');
        }
        return { rows, cursor: { x: buffer.cursorX, y: buffer.cursorY } };
    }

    async function settle(terminal: Terminal): Promise<void> {
        await new Promise<void>((resolve) => terminal.write('', resolve));
    }

    function emulator(cols: number, rows: number, unicode11: boolean): Terminal {
        const terminal = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
        if (unicode11) {
            terminal.loadAddon(new Unicode11Addon());
            terminal.unicode.activeVersion = '11';
        }
        return terminal;
    }

    test('a screen after a resize lands on the cells of the live stream, which Unicode 11 widths make possible', async () => {
        await harness.create('s1');
        const output = `${WIDE_LINES.join('\r\n')}\r\nprompt \u{1f680}`;
        harness.adapter.forSession('s1').emit(output);
        harness.manager.resize('s1', 33, 24);
        const { screen, cols, rows } = await harness.manager.attach('s1', 'c1', 33, 24);

        // What the stream shows a client that was attached all along: the same bytes and the same resize.
        const live = emulator(80, 24, true);
        live.write(output);
        live.resize(33, 24);
        await settle(live);

        const restored = emulator(cols, rows, true);
        restored.write(screen);
        await settle(restored);
        expect(cellsOf(restored)).toEqual(cellsOf(live));

        // The same session without the addon, to prove the comparison above can fail.
        const legacy = emulator(80, 24, false);
        const serializer = new SerializeAddon();
        legacy.loadAddon(serializer);
        legacy.write(output);
        legacy.resize(33, 24);
        await settle(legacy);
        const drifted = emulator(33, 24, true);
        drifted.write(serializer.serialize());
        await settle(drifted);
        expect(cellsOf(drifted).rows).not.toEqual(cellsOf(live).rows);
    });
});
