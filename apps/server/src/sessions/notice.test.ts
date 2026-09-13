import { afterEach, beforeEach, expect, test } from 'bun:test';
import { CLEAN_PATH, Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;
let recorder: Recorder;
let waiting: string[];

beforeEach(async () => {
    recorder = new Recorder();
    waiting = [];
    harness = await makeHarness({
        env: { PATH: CLEAN_PATH, PS1: '$ ' },
        firstNotices: () => waiting.splice(0, waiting.length)
    });
    harness.manager.subscribe('client', recorder.sink());
});

afterEach(async () => {
    await harness.cleanup();
});

const start = async (sessionId: string): Promise<void> => {
    await harness.manager.create({ sessionId, cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
    await harness.manager.attach(sessionId, 'client', 80, 24);
};

test('a message left before the node started stands above its first prompt', async () => {
    waiting = ['Ruimte: node term-1 ("shell") sent you a message: read the plan'];
    await start('term-a');
    expect(await harness.manager.get('term-a')!.plainText()).toContain('sent you a message: read the plan');
    expect(waiting).toEqual([]);
});

test('a message to a running shell reaches the screen and whoever watches it, and never the shell', async () => {
    await start('term-b');
    const session = harness.manager.get('term-b')!;
    // A prompt first, so the notice lands in the middle of a session rather than on an empty screen.
    session.write('echo ready\n');
    await waitFor(() => recorder.output.includes('ready'), 'the shell to answer');
    session.notice('Ruimte: node term-1 ("shell") sent you a message: the build is green');
    await waitFor(() => recorder.output.includes('the build is green'), 'the message on the wire');
    expect(await session.plainText()).toContain('the build is green');
    // Nothing was typed into the shell, so it never tried to run any of it.
    await Bun.sleep(50);
    expect(recorder.output).not.toContain('not found');
});
