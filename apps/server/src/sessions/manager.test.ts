import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RESTORED_TEXT } from './session.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, cols = 80, rows = 24) => harness.manager.create({ sessionId, cols, rows, shell: SH, args: SH_ARGS, cwd: harness.home });

describe('SessionManager', () => {
    test('streams output to an attached client and holds the screen for a reattach', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        const info = await create('s1');
        expect(info).toMatchObject({ sessionId: 's1', cols: 80, rows: 24, exited: false, attached: 0 });
        expect(info.pid).toBeGreaterThan(0);

        await harness.manager.attach('s1', 'c1', 80, 24);
        harness.manager.write('s1', 'echo hel""lo\n');
        await waitFor(() => recorder.output.includes('hello'), 'hello in the stream');

        harness.manager.detach('s1', 'c1');
        expect(harness.manager.list()[0]?.attached).toBe(0);

        const outputBefore = recorder.output;
        const attached = await harness.manager.attach('s1', 'c1', 80, 24);
        expect(attached.exited).toBe(false);
        expect(attached.screen).toContain('hello');
        // Nothing may be streamed for the period the client was gone; the screen carries it.
        expect(recorder.output).toBe(outputBefore);
    });

    test('a second client sees the screen the first produced, and both get new output', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());

        await create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        harness.manager.write('s2', 'echo fir""st\n');
        await waitFor(() => first.output.includes('first'), 'first');

        const attached = await harness.manager.attach('s2', 'c2', 80, 24);
        expect(attached.screen).toContain('first');
        expect(second.output).not.toContain('first');

        harness.manager.write('s2', 'echo sec""ond\n');
        await waitFor(() => first.output.includes('second') && second.output.includes('second'), 'second on both');
        expect(harness.manager.list()[0]?.attached).toBe(2);
    });

    test('resize reaches the shell and the last attacher decides the size', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s3');
        await harness.manager.attach('s3', 'c1', 80, 24);

        harness.manager.resize('s3', 100, 30);
        harness.manager.write('s3', 'stty size\n');
        await waitFor(() => recorder.output.includes('30 100'), 'stty after resize');

        const attached = await harness.manager.attach('s3', 'c1', 120, 40);
        expect(attached).toMatchObject({ cols: 120, rows: 40 });
        harness.manager.write('s3', 'stty size\n');
        await waitFor(() => recorder.output.includes('40 120'), 'stty after reattach');
    });

    test('kill delivers session.exit to attached clients and drops the session from the list', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s4');
        await harness.manager.attach('s4', 'c1', 80, 24);
        await harness.snapshots.write('s4', 'stale');

        await harness.manager.kill('s4');
        await waitFor(() => recorder.exitOf('s4') !== undefined, 'session.exit');
        expect(harness.manager.list()).toEqual([]);
        expect(harness.manager.get('s4')).toBeUndefined();
        expect(await harness.snapshots.read('s4')).toBeNull();
        expect(recorder.events.some((event) => event.event === 'session.list-changed')).toBe(true);
    });

    test('a shell that exits on its own stays listed as exited until it is killed or recreated', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s5');
        await harness.manager.attach('s5', 'c1', 80, 24);
        harness.manager.write('s5', 'exit 3\n');
        await waitFor(() => recorder.exitOf('s5') === 3, 'exit code 3');

        expect(harness.manager.list()[0]).toMatchObject({ sessionId: 's5', exited: true, exitCode: 3 });
        expect(() => harness.manager.write('s5', 'x')).toThrow(expect.objectContaining({ code: 'session-exited' }));

        const attached = await harness.manager.attach('s5', 'c1', 80, 24);
        expect(attached.exited).toBe(true);

        // Recreating the id carries the old screen over with the restored marker, like a disk snapshot would.
        await create('s5');
        const fresh = await harness.manager.attach('s5', 'c2', 80, 24);
        expect(fresh.exited).toBe(false);
        expect(fresh.screen).toContain('exit 3');
        expect(fresh.screen).toContain(RESTORED_TEXT);
    });

    test('refuses a duplicate id and an unknown id with their own codes', async () => {
        await create('s6');
        await expect(create('s6')).rejects.toMatchObject({ code: 'session-exists' });
        await expect(harness.manager.attach('nope', 'c1', 80, 24)).rejects.toMatchObject({ code: 'session-not-found' });
        expect(() => harness.manager.detach('nope', 'c1')).toThrow(expect.objectContaining({ code: 'session-not-found' }));
    });

    test('detachAll drops every attachment of one client and nothing of another', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());
        await create('s7');
        await create('s8');
        await harness.manager.attach('s7', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c2', 80, 24);

        harness.manager.detachAll('c1');
        const attached = Object.fromEntries(harness.manager.list().map((session) => [session.sessionId, session.attached]));
        expect(attached).toEqual({ s7: 0, s8: 1 });
    });

    test('sets the session environment the shell can read', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s9');
        await harness.manager.attach('s9', 'c1', 80, 24);
        harness.manager.write('s9', 'echo "$RUIMTE_SESSION_ID/$TERM/$COLORTERM"\n');
        await waitFor(() => recorder.output.includes('s9/xterm-256color/truecolor'), 'env line');
    });
});
