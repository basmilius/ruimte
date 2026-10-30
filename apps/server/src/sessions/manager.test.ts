import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { delimiter } from 'node:path';
import { RESTORED_TEXT } from './session.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

/* Output from the program in a session's PTY, delivered to every attached client right away instead of on the next tick. */
function print(sessionId: string, text: string): void {
    harness.adapter.forSession(sessionId).emit(text);
    harness.manager.get(sessionId)!.flush();
}

describe('SessionManager.killAllSettled', () => {
    test('waits for a kill that still runs, as a taskkill on Windows does', async () => {
        await harness.create('s1');
        const pty = harness.adapter.forSession('s1');
        const taskkill = Promise.withResolvers<void>();
        pty.pendingKill = taskkill.promise;
        let done = false;
        const ending = harness.manager.killAllSettled().then(() => {
            done = true;
        });
        await pty.exited;
        expect(pty.signals).toEqual(['SIGHUP']);
        expect(done).toBe(false);
        taskkill.resolve();
        await ending;
        expect(done).toBe(true);
    });

    test('stops waiting after its limit', async () => {
        jest.useFakeTimers();
        try {
            await harness.create('s1');
            harness.adapter.forSession('s1').pendingKill = new Promise<void>(() => undefined);
            let done = false;
            const ending = harness.manager.killAllSettled(3_000).then(() => {
                done = true;
            });
            jest.advanceTimersByTime(2_999);
            await Promise.resolve();
            expect(done).toBe(false);
            jest.advanceTimersByTime(1);
            await ending;
            expect(done).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('SessionManager', () => {
    test('a permission request only says the node needs a person; its CLI asks on its own screen', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');
        const hook = { hook_event_name: 'PermissionRequest', session_id: 'cli-1', tool_name: 'Bash', tool_input: { command: 'sleep 12' } };
        expect(await harness.manager.applyHook('claude', harness.manager.get('s1')!.hookToken, hook)).toBe('applied');
        expect(recorder.statusesOf('s1').at(-1)).toBe('needs-you');
        expect(recorder.events.some((event) => (event.event as string) === 'session.approvals')).toBe(false);
    });

    test('clear empties the buffer and hands every attached client the fresh screen', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);
        print('s1', 'hello\r\n$ ');
        expect(recorder.output).toContain('hello');

        await harness.manager.clear('s1');
        expect(recorder.resyncOf('s1')).toBeDefined();
        expect(recorder.resyncOf('s1')).not.toContain('hello');
        // The shell is never told: a clear is the daemon's screen alone.
        expect(harness.adapter.forSession('s1').input).toEqual([]);
        // The daemon owns the screen, so a reattach cannot bring the old one back either.
        const attached = await harness.manager.attach('s1', 'c1', 80, 24);
        expect(attached.screen).not.toContain('hello');
    });

    test('output that is still waiting for its tick is delivered before a clear, never on the fresh screen', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);

        harness.adapter.forSession('s1').emit('before the clear');
        await harness.manager.clear('s1');
        const outputAt = recorder.events.findIndex((event) => event.event === 'session.output');
        const resyncAt = recorder.events.findIndex((event) => event.event === 'session.resync');
        expect(recorder.output).toBe('before the clear');
        expect(outputAt).toBeLessThan(resyncAt);
    });

    test('streams output to an attached client and holds the screen for a reattach', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        const info = await harness.create('s1');
        expect(info).toMatchObject({ sessionId: 's1', cols: 80, rows: 24, exited: false, attached: 0 });
        expect(info.pid).toBe(harness.adapter.forSession('s1').pid);

        await harness.manager.attach('s1', 'c1', 80, 24);
        print('s1', 'hello\r\n');
        expect(recorder.output).toBe('hello\r\n');

        harness.manager.detach('s1', 'c1');
        expect(harness.manager.list()[0]?.attached).toBe(0);
        print('s1', 'while away\r\n');

        const outputBefore = recorder.output;
        const attached = await harness.manager.attach('s1', 'c1', 80, 24);
        expect(attached.exited).toBe(false);
        expect(attached.screen).toContain('hello');
        expect(attached.screen).toContain('while away');
        // Nothing may be streamed for the period the client was gone; the screen carries it.
        harness.manager.get('s1')!.flush();
        expect(recorder.output).toBe(outputBefore);
    });

    test('a detach hands over the tail buffered after the first output', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);
        const pty = harness.adapter.forSession('s1');

        jest.useFakeTimers();
        jest.setSystemTime(1000);
        try {
            pty.emit('one ');
            pty.emit('two');
            expect(recorder.output).toBe('one ');
            harness.manager.detach('s1', 'c1');
            expect(recorder.events.filter((event) => event.event === 'session.output').map((event) => event.payload)).toEqual([
                { sessionId: 's1', data: 'one ' },
                { sessionId: 's1', data: 'two' }
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a UTF-8 character split over two reads arrives whole', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);
        const bytes = new TextEncoder().encode('é');
        const pty = harness.adapter.forSession('s1');
        pty.emitBytes(bytes.slice(0, 1));
        pty.emitBytes(bytes.slice(1));
        harness.manager.get('s1')!.flush();
        expect(recorder.output).toBe('é');
    });

    test('a session with links at its start shows the context line above the first prompt; one without stays quiet', async () => {
        await harness.cleanup();
        harness = await makeHarness({ contextFor: (sessionId) => (sessionId === 'linked' ? [{ id: 'text-1', kind: 'text', title: 'Sprint goals' }] : []) });
        await harness.create('linked');
        await harness.create('plain');
        const linked = await harness.manager.attach('linked', 'c1', 80, 24);
        const plain = await harness.manager.attach('plain', 'c1', 80, 24);
        expect(linked.screen).toContain('Ruimte: linked context is available with ruimte-context (list, read <id>): "Sprint goals" (text).');
        expect(plain.screen).not.toContain('ruimte-context');
        // The line is on the screen only; the shell never received it as input.
        expect(harness.adapter.forSession('linked').input).toEqual([]);
    });

    test('a second client sees the screen the first produced, and both get new output', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());

        await harness.create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        print('s2', 'first\r\n');
        expect(first.output).toContain('first');

        const attached = await harness.manager.attach('s2', 'c2', 80, 24);
        expect(attached.screen).toContain('first');
        expect(second.output).not.toContain('first');

        print('s2', 'second\r\n');
        expect(first.output).toContain('second');
        expect(second.output).toContain('second');
        expect(harness.manager.list()[0]?.attached).toBe(2);
    });

    test('resize reaches the PTY and the last attacher decides the size', async () => {
        await harness.create('s3');
        const pty = harness.adapter.forSession('s3');
        await harness.manager.attach('s3', 'c1', 80, 24);
        // The size it was spawned with is no resize.
        expect(pty.resizes).toEqual([]);

        harness.manager.resize('s3', 100, 30);
        expect(pty.resizes).toEqual([{ cols: 100, rows: 30 }]);

        const attached = await harness.manager.attach('s3', 'c1', 120, 40);
        expect(attached).toMatchObject({ cols: 120, rows: 40 });
        expect(pty.resizes).toEqual([
            { cols: 100, rows: 30 },
            { cols: 120, rows: 40 }
        ]);
        expect(harness.manager.list()[0]).toMatchObject({ cols: 120, rows: 40 });
    });

    test('two clients on one terminal: the one at work sizes it, and every client hears the grid', async () => {
        const desk = new Recorder();
        const laptop = new Recorder();
        harness.manager.subscribe('desk', desk.sink());
        harness.manager.subscribe('laptop', laptop.sink());
        await harness.create('s3');
        const pty = harness.adapter.forSession('s3');
        const sizes = (recorder: Recorder) =>
            recorder.events.flatMap((event) => (event.event === 'session.size' ? [[event.payload.cols, event.payload.rows]] : []));

        await harness.manager.attach('s3', 'desk', 160, 50);
        await harness.manager.attach('s3', 'laptop', 100, 30);
        expect(pty.resizes.at(-1)).toEqual({ cols: 100, rows: 30 });
        expect(sizes(desk)).toEqual([[100, 30]]);

        // A refit to the grid it already claimed is not the desk at work.
        harness.manager.resize('s3', 160, 50, 'desk');
        expect(pty.resizes.at(-1)).toEqual({ cols: 100, rows: 30 });

        // What the desk's emulator answers by itself is not either; a keystroke is.
        harness.manager.write('s3', '\x1b[?1;2c', 'desk');
        expect(pty.resizes.at(-1)).toEqual({ cols: 100, rows: 30 });
        harness.manager.write('s3', 'l', 'desk');
        expect(pty.resizes.at(-1)).toEqual({ cols: 160, rows: 50 });
        expect(sizes(laptop)).toEqual([[160, 50]]);
        expect(sizes(desk)).toEqual([
            [100, 30],
            [160, 50]
        ]);

        // A node the laptop resizes hands it the terminal back.
        harness.manager.resize('s3', 110, 32, 'laptop');
        expect(pty.resizes.at(-1)).toEqual({ cols: 110, rows: 32 });
        expect(sizes(desk).at(-1)).toEqual([110, 32]);
    });

    test('a follower attaches without a grid and takes nothing with its keys', async () => {
        await harness.create('s3');
        const pty = harness.adapter.forSession('s3');
        await harness.manager.attach('s3', 'desk', 160, 50);
        await harness.manager.attach('s3', 'phone');
        harness.manager.write('s3', 'ls\r', 'phone');
        expect(pty.resizes).toEqual([{ cols: 160, rows: 50 }]);
    });

    test('a shell that has ended is not resized any more', async () => {
        await harness.create('s3');
        const pty = harness.adapter.forSession('s3');
        pty.exit(0);
        harness.manager.resize('s3', 100, 30);
        expect(pty.resizes).toEqual([]);
        expect(harness.manager.list()[0]).toMatchObject({ cols: 100, rows: 30 });
    });

    test('kill delivers session.exit to attached clients and drops the session from the list', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s4');
        await harness.manager.attach('s4', 'c1', 80, 24);
        await harness.snapshots.write('s4', 'stale');
        const pty = harness.adapter.forSession('s4');

        await harness.manager.kill('s4');
        expect(pty.signals).toEqual(['SIGHUP']);
        await pty.exited;
        expect(recorder.exitOf('s4')).toBe(129);
        expect(harness.manager.list()).toEqual([]);
        expect(harness.manager.get('s4')).toBeUndefined();
        expect(await harness.snapshots.read('s4')).toBeNull();
        expect(recorder.events.some((event) => event.event === 'session.list-changed')).toBe(true);
    });

    test('a shell that exits on its own stays listed as exited until it is killed or recreated', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.create('s5');
        await harness.manager.attach('s5', 'c1', 80, 24);
        const pty = harness.adapter.forSession('s5');
        pty.emit('$ exit 3\r\n');
        pty.exit(3);
        // Output from before the exit is flushed ahead of the exit event.
        expect(recorder.output).toContain('exit 3');
        expect(recorder.exitOf('s5')).toBe(3);

        expect(harness.manager.list()[0]).toMatchObject({ sessionId: 's5', exited: true, exitCode: 3 });
        expect(() => harness.manager.write('s5', 'x')).toThrow(expect.objectContaining({ code: 'session-exited' }));
        expect(pty.input).toEqual([]);

        const attached = await harness.manager.attach('s5', 'c1', 80, 24);
        expect(attached.exited).toBe(true);

        // Recreating the id carries the old screen over with the restored marker, like a disk snapshot would.
        await harness.create('s5');
        expect(harness.adapter.forSession('s5')).not.toBe(pty);
        const fresh = await harness.manager.attach('s5', 'c2', 80, 24);
        expect(fresh.exited).toBe(false);
        expect(fresh.screen).toContain('exit 3');
        expect(fresh.screen).toContain(RESTORED_TEXT);
        expect(fresh.screen.indexOf('exit 3')).toBeLessThan(fresh.screen.indexOf(RESTORED_TEXT));
    });

    test('an exited session that is killed goes at once, without a signal', async () => {
        await harness.create('s5');
        const pty = harness.adapter.forSession('s5');
        pty.exit(0);
        await harness.manager.kill('s5');
        expect(pty.signals).toEqual([]);
        expect(harness.manager.list()).toEqual([]);
    });

    test('refuses a duplicate id and an unknown id with their own codes', async () => {
        await harness.create('s6');
        await expect(harness.create('s6')).rejects.toMatchObject({ code: 'session-exists' });
        await expect(harness.manager.attach('nope', 'c1', 80, 24)).rejects.toMatchObject({ code: 'session-not-found' });
        expect(() => harness.manager.detach('nope', 'c1')).toThrow(expect.objectContaining({ code: 'session-not-found' }));
    });

    test('detachAll drops every attachment of one client and nothing of another', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());
        await harness.create('s7');
        await harness.create('s8');
        await harness.manager.attach('s7', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c2', 80, 24);

        harness.manager.detachAll('c1');
        const attached = Object.fromEntries(harness.manager.list().map((session) => [session.sessionId, session.attached]));
        expect(attached).toEqual({ s7: 0, s8: 1 });
    });

    test('spawns the shell with the size, the folder and the session environment', async () => {
        await harness.cleanup();
        harness = await makeHarness({ contextUrl: 'http://127.0.0.1:1/context', binDir: '/opt/ruimte/bin' });
        await harness.manager.create({ sessionId: 's9', cols: 90, rows: 30, shell: '/bin/sh', args: [], cwd: harness.home });
        await harness.manager.create({ sessionId: 's10', cols: 80, rows: 24, shell: '/bin/zsh', cwd: harness.home });

        const { options } = harness.adapter.forSession('s9');
        expect(options).toMatchObject({ shell: '/bin/sh', args: [], cwd: harness.home, cols: 90, rows: 30 });
        expect(options.env).toMatchObject({
            HOME: harness.home,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            RUIMTE_SESSION_ID: 's9',
            RUIMTE_HOOK_URL: 'http://127.0.0.1:1/hooks',
            RUIMTE_CONTEXT_URL: 'http://127.0.0.1:1/context',
            // In front, so `ruimte-context` wins over anything of the same name on the machine.
            PATH: ['/opt/ruimte/bin', '/usr/bin:/bin'].join(delimiter)
        });
        // A login shell reads the profile that sets PATH, which a daemon started from launchd lacks.
        expect(harness.adapter.forSession('s10').options.args).toEqual(['-l']);
    });
});

describe('SessionManager on Windows', () => {
    const bash = String.raw`C:\Program Files\Git\bin\bash.exe`;

    test('a line typed in Git Bash ends in the shell of the person', async () => {
        const windows = await makeHarness({ platform: 'win32', findGitBash: () => bash, personShell: () => 'powershell.exe' });
        try {
            await windows.manager.create({ cols: 80, rows: 24, cwd: windows.home, sessionId: 'command', command: 'echo hi' });
            const pty = windows.adapter.forSession('command');
            pty.emit('$ ');
            expect(pty.options.shell).toBe(bash);
            expect(pty.options.env.RUIMTE_START_LINE).toStartWith("echo hi; exec 'powershell.exe' '-NoLogo' '-NoExit' '-EncodedCommand' ");
            expect(windows.manager.get('command')!.handedBack).toBe(true);
        } finally {
            await windows.cleanup();
        }
    });

    test('a first prompt that starts with a slash survives the path conversion of Git Bash', async () => {
        const windows = await makeHarness({ platform: 'win32', findGitBash: () => bash, personShell: () => bash, firstPrompt: () => Promise.resolve('/init') });
        try {
            await windows.manager.create({ cols: 80, rows: 24, cwd: windows.home, sessionId: 'agent', agent: { kind: 'claude' } });
            const pty = windows.adapter.forSession('agent');
            pty.emit('$ ');
            expect(`${pty.options.env.RUIMTE_START_LINE ?? ''}${pty.typed}`).toContain("'//init'");
        } finally {
            await windows.cleanup();
        }
    });

    test('a person who chose Git Bash stays in it', async () => {
        const windows = await makeHarness({ platform: 'win32', findGitBash: () => bash, personShell: () => bash });
        try {
            await windows.manager.create({ cols: 80, rows: 24, cwd: windows.home, sessionId: 'command', command: 'echo hi' });
            const pty = windows.adapter.forSession('command');
            pty.emit('$ ');
            expect(pty.typed).toBe('echo hi\n');
            expect(windows.manager.get('command')!.handedBack).toBe(false);
        } finally {
            await windows.cleanup();
        }
    });

    test('a session that types a line runs in Git Bash, whatever shell was asked for', async () => {
        const windows = await makeHarness({ platform: 'win32', findGitBash: () => bash });
        try {
            const base = { cols: 80, rows: 24, shell: 'pwsh.exe', cwd: windows.home };
            await windows.manager.create({ ...base, sessionId: 'command', command: 'echo hi' });
            await windows.manager.create({ ...base, sessionId: 'launch', exec: 'bun dev' });
            await windows.manager.create({ ...base, sessionId: 'plain' });
            expect(windows.adapter.forSession('command').options.shell).toBe(bash);
            expect(windows.adapter.forSession('launch').options.shell).toBe(bash);
            expect(windows.adapter.forSession('launch').options.args).toEqual(['-l', '-i', '-c', 'bun dev']);
            expect(windows.adapter.forSession('plain').options.shell).toBe('pwsh.exe');
        } finally {
            await windows.cleanup();
        }
    });

    test('without Git Bash such a session is refused and a plain terminal still opens', async () => {
        const windows = await makeHarness({ platform: 'win32', findGitBash: () => null });
        try {
            const base = { cols: 80, rows: 24, cwd: windows.home };
            await expect(windows.manager.create({ ...base, sessionId: 'agent', agent: { kind: 'claude' } })).rejects.toMatchObject({
                code: 'git-bash-missing'
            });
            expect(windows.adapter.spawned).toHaveLength(0);
            await windows.manager.create({ ...base, sessionId: 'plain', shell: 'cmd.exe' });
            expect(windows.adapter.forSession('plain').options.shell).toBe('cmd.exe');
        } finally {
            await windows.cleanup();
        }
    });
});
