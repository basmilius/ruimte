import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SessionManager } from '../sessions/manager.ts';
import { Recorder, testPath, testShell, waitFor } from '../sessions/test-helpers.ts';
import { BunPtyAdapter } from './bun-pty.ts';

/*
 * What no fake can prove: that a real shell in a real PTY under the session layer answers. Kept out of
 * the default run because it waits on a process, and only a poll with a deadline can do that.
 */

let home: string;
let manager: SessionManager;
let recorder: Recorder;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-pty-'));
    // No login flag and a minimal environment, so the user's profile cannot leak into the screen.
    manager = new SessionManager({ adapter: new BunPtyAdapter(), env: { PATH: testPath, HOME: home, PS1: '$ ' } });
    recorder = new Recorder();
    manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    manager.killAll();
    await waitFor(() => manager.list().every((session) => session.exited), 'every shell to exit').catch(() => undefined);
    await rm(home, { recursive: true, force: true });
});

async function start(sessionId: string): Promise<void> {
    await manager.create({ sessionId, cols: 80, rows: 24, shell: testShell, args: [], cwd: home });
    await manager.attach(sessionId, 'c1', 80, 24);
}

describe('BunPtyAdapter under a SessionManager', () => {
    test('output of the shell reaches an attached client', async () => {
        await start('out');
        // The quotes keep the echo of the typed line from matching.
        manager.write('out', 'echo hel""lo\n');
        await waitFor(() => recorder.output.includes('hello'), 'hello in the stream');
    });

    test.skipIf(process.platform !== 'win32')('a resize reaches PowerShell through the ConPTY', async () => {
        await manager.create({ sessionId: 'size', cols: 80, rows: 24, shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile'], cwd: home });
        await manager.attach('size', 'c1', 80, 24);
        await waitFor(() => recorder.output.includes('PS '), 'the prompt');
        manager.resize('size', 100, 30);
        manager.write('size', "'width' + $Host.UI.RawUI.WindowSize.Width + 'x'\r");
        await waitFor(() => recorder.output.includes('width100x'), 'the width after a resize');
    });

    // Git Bash's stty reads no size from a ConPTY, so Windows has its own test above.
    test.skipIf(process.platform === 'win32')('a resize reaches the shell', async () => {
        await start('size');
        // A loaded runner may still be starting the shell, so the grid changes once it prompts.
        await waitFor(() => recorder.output.includes('$ '), 'the prompt');
        manager.resize('size', 100, 30);
        manager.write('size', 'stty size\n');
        await waitFor(() => recorder.output.includes('30 100'), 'stty after resize').catch((error: Error) => {
            throw new Error(`${error.message}; the shell wrote ${JSON.stringify(recorder.output)}`);
        });
    });

    test('the exit code of the shell comes through', async () => {
        await start('exit');
        manager.write('exit', 'exit 3\n');
        await waitFor(() => recorder.exitOf('exit') === 3, 'exit code 3');
        expect(manager.list()[0]).toMatchObject({ exited: true, exitCode: 3 });
    });

    test('a kill ends the shell', async () => {
        await start('kill');
        await manager.kill('kill');
        await waitFor(() => recorder.exitOf('kill') !== undefined, 'session.exit');
        expect(manager.list()).toEqual([]);
    });
});
