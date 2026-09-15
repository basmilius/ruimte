import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
let recorder: Recorder;
let waiting: string[];

beforeEach(async () => {
    recorder = new Recorder();
    waiting = [];
    harness = await makeHarness({ firstNotices: () => waiting.splice(0, waiting.length) });
    harness.manager.subscribe('client', recorder.sink());
});

afterEach(async () => {
    await harness.cleanup();
});

const start = async (sessionId: string): Promise<void> => {
    await harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home });
    await harness.manager.attach(sessionId, 'client', 80, 24);
};

test('a message left before the node started stands above its first prompt', async () => {
    waiting = ['Ruimte: node term-1 ("shell") sent you a message: read the plan'];
    await start('term-a');
    expect(await harness.manager.get('term-a')!.plainText()).toContain('sent you a message: read the plan');
    expect(waiting).toEqual([]);
    expect(harness.adapter.forSession('term-a').input).toEqual([]);
});

test('a message to a running shell reaches the screen and whoever watches it, and never the shell', async () => {
    await start('term-b');
    const session = harness.manager.get('term-b')!;
    // A prompt first, so the notice lands in the middle of a session rather than on an empty screen.
    harness.adapter.forSession('term-b').emit('$ ');
    session.notice('Ruimte: node term-1 ("shell") sent you a message: the build is green');
    session.flush();
    // On a line of its own, since the prompt was half drawn where it landed.
    expect(recorder.output).toStartWith('$ \r\n');
    expect(recorder.output).toContain('the build is green');
    expect(await session.plainText()).toContain('the build is green');
    expect(harness.adapter.forSession('term-b').input).toEqual([]);
});
