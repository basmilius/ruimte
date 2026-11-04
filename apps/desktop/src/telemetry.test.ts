import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDedupeStore } from '@ruimte/telemetry';
import { fileDedupeStore } from '@ruimte/telemetry/file-store';
import { isCrash, problemEvent, processTag, shellBeforeSend, shellTags } from './telemetry';

const IDENTITY = { home: '/Users/jane', username: 'jane', hostname: 'janes-mac' };

describe('isCrash', () => {
    test('is a crash or running out of memory, never an exit that was asked for', () => {
        expect(['crashed', 'oom'].filter(isCrash)).toEqual(['crashed', 'oom']);
        expect(['clean-exit', 'killed', 'abnormal-exit', 'launch-failed'].filter(isCrash)).toEqual([]);
    });
});

describe('shellTags', () => {
    test('names the Electron, and on Linux whether an AppImage runs', () => {
        expect(shellTags({ platform: 'darwin', arch: 'arm64', electron: '44.9.0', appImage: undefined })).toEqual({
            process: 'main',
            platform: 'darwin',
            arch: 'arm64',
            electron: '44.9.0'
        });
        expect(shellTags({ platform: 'linux', arch: 'x64', electron: '44.9.0', appImage: '/home/jane/Ruimte.AppImage' }).package).toBe('appimage');
        expect(shellTags({ platform: 'linux', arch: 'x64', electron: '44.9.0', appImage: undefined }).package).toBe('installed');
    });
});

describe('problemEvent', () => {
    test('names a gone process by its kind and reason, and groups by them', () => {
        expect(problemEvent({ kind: 'process-gone', process: processTag('Sandbox helper'), reason: 'oom', exitCode: 9 })).toEqual({
            message: 'The sandbox-helper process is gone (oom)',
            level: 'fatal',
            fingerprint: ['process-gone', 'sandbox-helper', 'oom'],
            tags: { problem: 'process-gone', process: 'sandbox-helper', exit_reason: 'oom' },
            extra: { exit_code: 9 }
        });
    });

    test('a renderer that ran out of memory says how large it was and how long it ran', () => {
        const memory = { memoryMb: 3900, peakMemoryMb: 4010, uptimeMin: 312, guests: 4 };
        const event = problemEvent({ kind: 'process-gone', process: 'renderer', reason: 'oom', exitCode: 5, memory });
        expect(event.extra).toEqual({ exit_code: 5, memory_mb: 3900, peak_memory_mb: 4010, uptime_min: 312, guests: 4 });
        expect(shellBeforeSend({ home: '/Users/jane', username: 'jane', hostname: 'box' }, memoryDedupeStore())(event)?.extra).toEqual(event.extra);
    });

    test('says which step of the service failed', () => {
        const event = problemEvent({ kind: 'service-fallback', step: 'install', reason: 'Bootstrap failed: 5' });
        expect(event.tags).toEqual({ problem: 'service-fallback', step: 'install' });
        expect(event.fingerprint).toEqual(['service-fallback', 'install']);
    });

    test('says why the account session was cleared', () => {
        const event = problemEvent({ kind: 'session-cleared', reason: 'bad-signature' });
        expect(event.tags).toEqual({ problem: 'session-cleared', reason: 'bad-signature' });
        expect(event.fingerprint).toEqual(['session-cleared', 'bad-signature']);
    });
});

describe('shellBeforeSend', () => {
    test.each([
        { exitCode: 127, signal: null, expected: { exit_code: 127 } },
        { exitCode: null, signal: 'SIGILL' as const, expected: { signal: 'SIGILL' } }
    ])('keeps daemon startup diagnostics after scrubbing ($exitCode, $signal)', ({ exitCode, signal, expected }) => {
        const beforeSend = shellBeforeSend(IDENTITY, memoryDedupeStore());
        const sent = beforeSend(
            problemEvent({
                kind: 'daemon-start-failed',
                reason: 'The background service did not come up',
                daemon: {
                    exitCode,
                    signal,
                    output: [
                        'error while loading shared libraries: libatomic.so.1',
                        'Could not read "/Users/jane/private/config.json"',
                        'Authorization: Bearer obsp_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
                    ]
                }
            })
        );
        expect(sent).toMatchObject({
            extra: {
                reason: 'The background service did not come up',
                ...expected,
                startup_output: ['error while loading shared libraries: libatomic.so.1', 'Could not read "<text>"', expect.stringContaining('<redacted>')]
            }
        });
        expect(JSON.stringify(sent)).not.toContain('jane');
        expect(JSON.stringify(sent)).not.toContain('obsp_');
    });

    test('bounds the startup output that leaves the machine', () => {
        const beforeSend = shellBeforeSend(IDENTITY, memoryDedupeStore());
        const sent = beforeSend(
            problemEvent({
                kind: 'daemon-start-failed',
                reason: 'The background service did not come up',
                daemon: { exitCode: 1, signal: null, output: Array.from({ length: 20 }, () => 'x'.repeat(1000)) }
            })
        );
        const output = sent?.extra.startup_output;
        expect(Array.isArray(output)).toBe(true);
        if (Array.isArray(output)) {
            expect(output).toHaveLength(10);
            expect(output.every((line) => line.length <= 303)).toBe(true);
        }
    });

    test('scrubs the reason of its paths and person, and drops tags it does not know', () => {
        const beforeSend = shellBeforeSend(IDENTITY, memoryDedupeStore());
        const event = problemEvent({ kind: 'daemon-start-failed', reason: 'The background service is missing in /Users/jane/Apps/Ruimte.app/bin' });
        const sent = beforeSend({ ...event, tags: { ...event.tags, user: 'jane' } });
        expect(sent).toMatchObject({
            message: 'The machine did not start',
            tags: { problem: 'daemon-start-failed' },
            extra: { reason: 'The background service is missing in <path>' }
        });
        expect(JSON.stringify(sent)).not.toContain('jane');
    });

    test('lets the same problem out once a day', () => {
        let now = 0;
        const beforeSend = shellBeforeSend(IDENTITY, memoryDedupeStore(), () => now);
        const event = () => problemEvent({ kind: 'daemon-gave-up', ends: 6 });
        expect(beforeSend(event())).not.toBeNull();
        expect(beforeSend(event())).toBeNull();
        now = 25 * 60 * 60 * 1000;
        expect(beforeSend(event())).not.toBeNull();
    });

    test('names the process of a native crash and lets one per process a day out', () => {
        const beforeSend = shellBeforeSend(IDENTITY, memoryDedupeStore());
        const native = (process: string) => ({ level: 'fatal', platform: 'native', tags: { 'event.process': process, process: 'main' } });
        expect(beforeSend(native('GPU'))).toMatchObject({ tags: { process: 'gpu' } });
        expect(beforeSend(native('GPU'))).toBeNull();
        expect(beforeSend(native('renderer'))).toMatchObject({ tags: { process: 'renderer' } });
    });

    test('remembers what went out in a file of its own', () => {
        const folder = mkdtempSync(join(tmpdir(), 'ruimte-shell-telemetry-'));
        try {
            const path = join(folder, 'telemetry', 'sent.json');
            const beforeSend = shellBeforeSend(IDENTITY, fileDedupeStore(path));
            beforeSend(problemEvent({ kind: 'daemon-spawn-failed', code: 'ENOENT' }));
            expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')))).toHaveLength(1);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });
});
