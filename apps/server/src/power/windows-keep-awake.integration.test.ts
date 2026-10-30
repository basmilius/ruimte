import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { ExecutionStateHold, windowsPower } from './windows-keep-awake.ts';

/* What Windows itself says is holding the system up; needs an elevated session, which the PC's SSH is. */
function systemRequests(): string {
    return spawnSync('powercfg', ['/requests'], { encoding: 'utf8', timeout: 20_000 }).stdout;
}

/* `DISPLAY:` then `SYSTEM:` then `AWAYMODE:`: the lines that belong to one heading. */
function requestsOf(output: string, heading: string): string {
    return (new RegExp(`${heading}:\\r?\\n([\\s\\S]*?)\\r?\\n\\r?\\n`).exec(output)?.[1] ?? '').toLowerCase();
}

const holder = 'bun';

describe.skipIf(process.platform !== 'win32')('the Windows execution state', () => {
    // Without the display: an SSH session is in session 0, where Windows silently drops ES_DISPLAY_REQUIRED.
    test('Windows lists the block while held and drops it after', () => {
        const held = new ExecutionStateHold(windowsPower()).hold({ onBattery: true, display: false });
        expect(requestsOf(systemRequests(), 'SYSTEM')).toContain(holder);
        held.kill();
        expect(requestsOf(systemRequests(), 'SYSTEM')).not.toContain(holder);
    });

    test('a killed holder leaves nothing behind', async () => {
        const script = `import { ExecutionStateHold, windowsPower } from ${JSON.stringify(import.meta.dir.replaceAll('\\', '/') + '/windows-keep-awake.ts')};
new ExecutionStateHold(windowsPower()).hold({ onBattery: true, display: false });
console.log('held');
setInterval(() => {}, 1000);`;
        const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'ignore' });
        await child.stdout.getReader().read();
        expect(requestsOf(systemRequests(), 'SYSTEM')).toContain(holder);
        child.kill('SIGKILL');
        await child.exited;
        expect(requestsOf(systemRequests(), 'SYSTEM')).not.toContain(holder);
    });

    test('the power source watch fires on the JS thread and ends without keeping the process', async () => {
        const power = windowsPower();
        // Windows calls a new registration once with the current source.
        const fired = Promise.withResolvers<void>();
        const stop = power.watchPowerSource(() => fired.resolve());
        await fired.promise;
        stop();
        expect(typeof power.onAdapter()).toBe('boolean');
    });
});
