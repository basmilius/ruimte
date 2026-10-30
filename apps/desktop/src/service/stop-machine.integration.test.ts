import { afterEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', '..', 'build', 'stop-machine.ps1');

/* A stand-in that answers nothing, so `stop` runs into its hard stop as with a daemon that hangs. */
const PING = 'C:\\Windows\\System32\\PING.EXE';

function script(installDir: string, action: 'check' | 'stop'): number {
    return Bun.spawnSync([
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT,
        '-InstallDir',
        installDir,
        '-Action',
        action
    ]).exitCode;
}

function running(path: string): Bun.Subprocess {
    return Bun.spawn([path, '-n', '120', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
}

describe.skipIf(process.platform !== 'win32')('stop-machine.ps1', () => {
    const folders: string[] = [];
    const children: Bun.Subprocess[] = [];

    afterEach(() => {
        children.splice(0).forEach((child) => child.kill());
        folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
    });

    const copyAt = (folder: string, name: string): string => {
        const path = join(folder, name);
        mkdirSync(join(path, '..'), { recursive: true });
        copyFileSync(PING, path);
        return path;
    };

    test('ends what runs from the installation and leaves a same-named process elsewhere', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'ruimte-stop-machine-'));
        folders.push(folder);
        const installDir = join(folder, 'Ruimte');
        const daemon = running(copyAt(installDir, join('resources', 'bin', 'ruimte.exe')));
        const elsewhere = running(copyAt(join(folder, 'other'), 'ruimte.exe'));
        children.push(daemon, elsewhere);

        expect(script(installDir, 'check')).toBe(0);
        expect(script(installDir, 'stop')).toBe(0);
        expect(script(installDir, 'check')).toBe(1);
        await daemon.exited;
        expect(elsewhere.exitCode).toBeNull();
    }, 60_000);
});
