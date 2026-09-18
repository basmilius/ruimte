import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LIVE_STREAM_MAGIC, LiveStreamDecoder } from '../../../packages/contracts/src';
import { repositoryRoot, startDaemon } from './wire-client';

const target = { backendId: 'test-device', platform: 'ios', deviceId: 'fake-ios-1' } as const;

test('native device RPC, event and HTTP streams enforce ownership, auth and cleanup', async () => {
    const helper = join(import.meta.dir, 'fixtures/device-helper.ts');
    const home = await mkdtemp(join(tmpdir(), 'ruimte-device-wire-'));
    const log = join(home, 'device-helper.log');
    const blockStart = join(home, 'block-device-start');
    const daemon = await startDaemon({
        home,
        env: {
            RUIMTE_DEVICE_TEST_BACKEND: helper,
            RUIMTE_DEVICE_TEST_BLOCK_START_FILE: blockStart,
            RUIMTE_DEVICE_TEST_LOG: log,
            RUIMTE_DEVICE_TEST_READY_DELAY_MS: '150'
        }
    });
    const owner = await daemon.connect();
    const stranger = await daemon.connect();
    try {
        const listed = await owner.call('device.list', {});
        expect(listed.devices.find((device: { backendId: string }) => device.backendId === target.backendId)).toEqual(
            expect.objectContaining({ ...target, name: 'Fake iPhone', state: 'booted' })
        );
        expect(await owner.call('device.detail', target)).toMatchObject({ ...target, settings: { appearance: 'light', textSize: 'default' } });
        expect(await owner.call('device.action', { ...target, action: 'setAppearance', value: 'dark' })).toMatchObject({
            ...target,
            settings: { appearance: 'dark' }
        });

        await expect(stranger.call('device.input', { ...target, input: { kind: 'button', button: 'home' } })).rejects.toThrow('device-not-open');

        const eventOpen = await owner.call('device.open', { ...target, stream: 'events' });
        expect(eventOpen.streamId).toStartWith('device:');
        await waitFor(() => owner.frames.some((frame) => frame.event === 'device.frame'), 'device frame event');
        const event = owner.frames.find((frame) => frame.event === 'device.frame')!.payload;
        expect(event).toMatchObject({ ...target, sequence: 7, width: 320, height: 640, data: '/9j/2Q==' });
        expect(event.format).toBeUndefined();
        expect(owner.violations).toEqual([]);

        const inputs = [
            { kind: 'pointer', phase: 'down', x: 0.25, y: 0.75, edge: 'bottom' },
            { kind: 'multiPointer', phase: 'move', first: { x: 0.2, y: 0.5 }, second: { x: 0.8, y: 0.5 } },
            { kind: 'scroll', deltaX: 12, deltaY: -30, x: 0.4, y: 0.6 },
            { kind: 'button', button: 'appSwitcher' },
            { kind: 'rotate', direction: 'left' }
        ];
        for (const input of inputs) {
            await owner.call('device.input', { ...target, input });
        }
        await waitFor(async () => inputLog(await logText(log)).length === inputs.length, 'helper inputs');
        expect(inputLog(await logText(log))).toEqual(inputs);
        await owner.call('device.detach', target);
        await expect(owner.call('device.input', { ...target, input: { kind: 'button', button: 'home' } })).rejects.toThrow('device-not-open');
        await waitFor(async () => count(await logText(log), 'stop') >= 1, 'event stream cleanup');

        const startsBeforeSharedOpen = count(await logText(log), `start ${target.deviceId}`);
        const [ownerShared, strangerShared] = await Promise.all([
            owner.call('device.open', { ...target, stream: 'events' }),
            stranger.call('device.open', { ...target, stream: 'events' })
        ]);
        expect(strangerShared.streamId).toBe(ownerShared.streamId);
        await waitFor(async () => count(await logText(log), `start ${target.deviceId}`) > startsBeforeSharedOpen, 'shared helper start');
        expect(count(await logText(log), `start ${target.deviceId}`)).toBe(startsBeforeSharedOpen + 1);
        const stopsBeforeSharedDetach = count(await logText(log), 'stop');
        await owner.call('device.detach', target);
        await stranger.call('device.input', { ...target, input: { kind: 'button', button: 'lock' } });
        await waitFor(
            async () =>
                inputLog(await logText(log)).some((input) => {
                    const value = input as { kind?: string; button?: string };
                    return value.kind === 'button' && value.button === 'lock';
                }),
            'remaining owner input'
        );
        expect(count(await logText(log), 'stop')).toBe(stopsBeforeSharedDetach);
        await stranger.call('device.detach', target);
        await waitFor(async () => count(await logText(log), 'stop') > stopsBeforeSharedDetach, 'last owner cleanup');

        const httpOpen = await owner.call('device.open', target);
        expect((await fetch(`${daemon.base}/live-stream/${encodeURIComponent(httpOpen.streamId)}`)).status).toBe(401);
        const response = await daemon.request(`/live-stream/${encodeURIComponent(httpOpen.streamId)}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/x-ruimte-jpeg-stream; version=1');
        const reader = response.body!.getReader();
        const decoded = await readFrame(reader);
        expect(decoded).toMatchObject({ sequence: 7, width: 320, height: 640 });
        await reader.cancel();

        const pairing = await owner.call('auth.pairingToken', {});
        const token = new URL(pairing.url).hash.slice(1);
        const pairedResponse = await fetch(`${daemon.base}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, label: 'Device stream' })
        });
        expect(pairedResponse.status).toBe(200);
        const paired = (await pairedResponse.json()) as { sessionToken: string };
        const pairedStream = await fetch(`${daemon.base}/live-stream/${encodeURIComponent(httpOpen.streamId)}`, {
            headers: { authorization: `Bearer ${paired.sessionToken}` }
        });
        expect(pairedStream.status).toBe(200);
        const pairedReader = pairedStream.body!.getReader();
        await readFrame(pairedReader);
        const stopsBeforeRevocation = count(await logText(log), 'stop');
        const sessions = await owner.call('auth.sessions', {});
        const session = sessions.sessions.find((candidate: { label: string }) => candidate.label === 'Device stream');
        await owner.call('auth.revoke', { id: session.id });
        const revoked = await Promise.race([pairedReader.read(), Bun.sleep(3000).then(() => null)]);
        expect(revoked?.done).toBeTrue();
        await waitFor(async () => count(await logText(log), 'stop') > stopsBeforeRevocation, 'revoked stream cleanup');
        expect(await owner.call('device.shutdown', target)).toMatchObject({ ...target, state: 'shutdown' });
        expect(await owner.call('device.boot', target)).toMatchObject({ ...target, state: 'booted' });

        await writeFile(blockStart, 'hold');
        const startsBeforePolicy = count(await logText(log), `start ${target.deviceId}`);
        const pending = owner.call('device.open', { ...target, stream: 'events' }).then(
            () => ({ ok: true as const, error: null }),
            (error: unknown) => ({ ok: false as const, error })
        );
        await waitFor(async () => count(await logText(log), `start ${target.deviceId}`) > startsBeforePolicy, 'blocked helper start');
        const disabled = owner.call('endpoint.setIdentity', { name: null, icon: null, streamingAllowed: false });
        const disableResult = await Promise.race([disabled.then(() => 'closed' as const), Bun.sleep(3000).then(() => 'timeout' as const)]);
        await rm(blockStart, { force: true });
        expect(disableResult).toBe('closed');
        await disabled;
        const pendingResult = await pending;
        expect(pendingResult.ok).toBeFalse();
        expect(String(pendingResult.error)).toContain('device-');
        await expect(owner.call('device.list', {})).rejects.toThrow('streaming-disabled');
        expect((await daemon.request(`/live-stream/${encodeURIComponent(httpOpen.streamId)}`)).status).toBe(403);

        await owner.call('endpoint.setIdentity', { name: null, icon: null, streamingAllowed: true });
        const recovery = await owner.call('device.open', target);
        await writeFile(blockStart, 'hold');
        const startsBeforeAbort = count(await logText(log), `start ${target.deviceId}`);
        const controller = new AbortController();
        const canceledStream = daemon.request(`/live-stream/${encodeURIComponent(recovery.streamId)}`, { signal: controller.signal }).then(
            () => ({ ok: true as const }),
            () => ({ ok: false as const })
        );
        await waitFor(async () => count(await logText(log), `start ${target.deviceId}`) > startsBeforeAbort, 'HTTP helper start');
        const stopsBeforeAbort = count(await logText(log), 'stop');
        controller.abort();
        expect((await canceledStream).ok).toBeFalse();
        await waitFor(async () => count(await logText(log), 'stop') > stopsBeforeAbort, 'canceled HTTP startup cleanup');
        await rm(blockStart, { force: true });
        await owner.call('device.open', { ...target, stream: 'events' }).catch((error) => {
            throw new Error(`Device did not recover after streaming was re-enabled: ${String(error)}`);
        });
        const stops = count(await logText(log), 'stop');
        owner.close();
        await waitFor(async () => count(await logText(log), 'stop') > stops, 'connection detach cleanup');
        expect(owner.violations).toEqual([]);
    } finally {
        owner.close();
        stranger.close();
        await daemon.stop();
        await rm(home, { recursive: true, force: true });
    }
}, 60_000);

test('the shared HTTP envelope advertises native HEVC device frames', async () => {
    const daemon = await startDaemon({
        env: {
            RUIMTE_DEVICE_TEST_BACKEND: join(import.meta.dir, 'fixtures/device-helper.ts'),
            RUIMTE_DEVICE_TEST_FORMAT: 'hevc'
        }
    });
    const connection = await daemon.connect();
    try {
        await connection.call('device.open', { ...target, stream: 'events' });
        await waitFor(() => connection.frames.some((frame) => frame.event === 'device.frame'), 'HEVC device event');
        const event = connection.frames.find((frame) => frame.event === 'device.frame')!.payload;
        expect(event.format).toBe('hevc');
        expect(connection.violations).toEqual([]);
        const opened = await connection.call('device.open', target);
        const response = await daemon.request(`/live-stream/${encodeURIComponent(opened.streamId)}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/x-ruimte-hevc-stream; version=1');
        expect(await readFrame(response.body!.getReader())).toMatchObject({ sequence: 7, width: 320, height: 640 });
    } finally {
        connection.close();
        await daemon.stop();
    }
}, 30_000);

test('HTTP distinguishes an unknown stream from a device helper startup failure', async () => {
    const daemon = await startDaemon({
        env: {
            RUIMTE_DEVICE_TEST_BACKEND: join(import.meta.dir, 'fixtures/device-helper.ts'),
            RUIMTE_DEVICE_TEST_FAIL_START: '1'
        }
    });
    const connection = await daemon.connect();
    try {
        const missing = await daemon.request('/live-stream/missing-stream');
        expect(missing.status).toBe(404);
        expect(await missing.text()).toBe('Live stream not found');

        const opened = await connection.call('device.open', target);
        const failed = await daemon.request(`/live-stream/${encodeURIComponent(opened.streamId)}`);
        expect(failed.status).toBe(503);
        expect(await failed.text()).toBe('The fake device helper refused to start');
    } finally {
        connection.close();
        await daemon.stop();
    }
}, 30_000);

test('the private physical helper mode refuses an incomplete inherited handshake', async () => {
    if (process.platform !== 'darwin') {
        return;
    }
    const child = Bun.spawn(
        [
            join(repositoryRoot, 'apps/server-rust/target/debug/ruimte-server'),
            '__physical-device-helper',
            '--udid',
            'not-a-real-device',
            'coredevice-not-a-real-device'
        ],
        { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
    );
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('helper handshake ended early');
    expect(stderr).not.toContain('listening on');
}, 10_000);

const readFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new LiveStreamDecoder();
    let prefix = new Uint8Array();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const result = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)]);
        if (!result || result.done) {
            continue;
        }
        if (prefix.byteLength < LIVE_STREAM_MAGIC.byteLength) {
            const missing = LIVE_STREAM_MAGIC.byteLength - prefix.byteLength;
            prefix = concat(prefix, result.value.slice(0, missing));
            if (prefix.byteLength === LIVE_STREAM_MAGIC.byteLength) {
                expect([...prefix]).toEqual([...LIVE_STREAM_MAGIC]);
            }
        }
        const frames = decoder.push(result.value);
        if (frames.length > 0) {
            return frames[0];
        }
    }
    throw new Error('Timed out waiting for an RSTM frame');
};

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
    const result = new Uint8Array(left.byteLength + right.byteLength);
    result.set(left);
    result.set(right, left.byteLength);
    return result;
};

const logText = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '');

const count = (text: string, line: string): number => text.split('\n').filter((entry) => entry === line).length;

const inputLog = (text: string): unknown[] =>
    text
        .split('\n')
        .filter((line) => line.startsWith('input '))
        .map((line) => JSON.parse(line.slice('input '.length)));

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
    const deadline = Date.now() + 8000;
    while (!(await predicate())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(20);
    }
};
