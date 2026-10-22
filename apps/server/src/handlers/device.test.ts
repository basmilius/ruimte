import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { DeviceError, type DeviceManager } from '../devices/manager.ts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { DeviceControl } from '../devices/control.ts';
import { SIMULATOR } from '../devices/device-test-helpers.ts';
import { registerDeviceControlHandlers, registerDeviceHandlers } from './device.ts';

function request(type: string, payload: unknown = {}): string {
    return JSON.stringify({ id: type, type, payload });
}

const home = mkdtempSync(join(tmpdir(), 'ruimte-device-handlers-'));

afterAll(() => {
    rmSync(home, { recursive: true, force: true });
});

function setup(devices: DeviceManager, allowed: () => boolean) {
    const dispatcher = new Dispatcher();
    registerDeviceHandlers(dispatcher, devices, allowed, home);
    const frames: ServerFrame[] = [];
    const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
    return { dispatcher, frames, client };
}

describe('device handlers', () => {
    test('the machine policy refuses device discovery before touching simctl', async () => {
        let listed = 0;
        const devices = {
            list() {
                listed += 1;
                return Promise.resolve([]);
            }
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => false);

        await dispatcher.handle(client, request('device.list'));

        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'streaming-disabled' } });
        expect(listed).toBe(0);
    });

    test('the machine policy refuses driving a device that was already open', async () => {
        let inputs = 0;
        const devices = {
            input() {
                inputs += 1;
                return Promise.resolve();
            }
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => false);

        await dispatcher.handle(
            client,
            request('device.input', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 } })
        );

        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'streaming-disabled' } });
        expect(inputs).toBe(0);
    });

    test('translates backend failures into stable request errors', async () => {
        const devices = {
            boot() {
                throw new DeviceError('simctl-failed', 'The simulator could not start');
            }
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => true);

        await dispatcher.handle(client, request('device.boot', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' }));

        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'simctl-failed', message: 'The simulator could not start' } });
    });

    test('passes the client identity through open, input and detach', async () => {
        const calls: unknown[][] = [];
        const devices = {
            open(...args: unknown[]) {
                calls.push(['open', ...args]);
                return Promise.resolve({
                    deviceId: 'phone-1',
                    backendId: 'simctl',
                    platform: 'ios',
                    kind: 'simulator',
                    name: 'iPhone 18 Pro',
                    runtime: 'iOS 27.0',
                    state: 'booted',
                    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true },
                    streamId: 'device:stream-1'
                });
            },
            input(...args: unknown[]) {
                calls.push(['input', ...args]);
                return Promise.resolve();
            },
            detach(...args: unknown[]) {
                calls.push(['detach', ...args]);
            }
        } as unknown as DeviceManager;
        const { dispatcher, client } = setup(devices, () => true);

        await dispatcher.handle(client, request('device.open', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'events' }));
        await dispatcher.handle(
            client,
            request('device.input', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 } })
        );
        await dispatcher.handle(client, request('device.detach', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' }));

        expect(calls).toEqual([
            ['open', 'simctl', 'ios', 'phone-1', 'client-1', 'events'],
            ['input', 'simctl', 'phone-1', 'client-1', { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 }],
            ['detach', 'simctl', 'phone-1', 'client-1']
        ]);
    });

    test('reads settings and passes typed actions to the manager', async () => {
        const calls: unknown[][] = [];
        const devices = {
            detail(...args: unknown[]) {
                calls.push(['detail', ...args]);
                return Promise.resolve({ appearance: 'dark' });
            },
            action(...args: unknown[]) {
                calls.push(['action', ...args]);
                return Promise.resolve({ appearance: 'light' });
            }
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => true);
        const target = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' };

        await dispatcher.handle(client, request('device.detail', target));
        await dispatcher.handle(client, request('device.action', { ...target, action: 'setAppearance', value: 'light' }));

        expect(calls).toEqual([
            ['detail', 'simctl', 'ios', 'phone-1'],
            ['action', { ...target, action: 'setAppearance', value: 'light' }]
        ]);
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { ...target, settings: { appearance: 'light' } } });
    });

    test("answers a phone's power, and nothing while the machine does not stream devices", async () => {
        const devices = {
            power: (...args: unknown[]) => Promise.resolve(args[2] === 'R5CT' ? { level: 14, plugged: false, charging: false } : null)
        } as unknown as DeviceManager;
        const allowed = { now: true };
        const { dispatcher, frames, client } = setup(devices, () => allowed.now);

        await dispatcher.handle(client, request('device.power', { backendId: 'android', platform: 'android', deviceId: 'R5CT' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { power: { level: 14, plugged: false, charging: false } } });
        await dispatcher.handle(client, request('device.power', { backendId: 'android', platform: 'android', deviceId: 'emulator-5554' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { power: null } });
        allowed.now = false;
        await dispatcher.handle(client, request('device.power', { backendId: 'android', platform: 'android', deviceId: 'R5CT' }));
        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'streaming-disabled' } });
    });

    test("writes a person's capture under the machine's captures and answers its path and size", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb6, 0, 0, 0x0a, 0x3e]);
        const devices = { capture: () => Promise.resolve(png) } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => true);

        await dispatcher.handle(client, request('device.capture', { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' }));

        const reply = frames.at(-1) as { ok: true; result: { path: string; width: number; height: number } };
        expect(reply.result).toMatchObject({ width: 1206, height: 2622 });
        expect(reply.result.path.startsWith(join(home, 'device-captures', 'phone-1-'))).toBe(true);
        expect(new Uint8Array(readFileSync(reply.result.path))).toEqual(png);
    });

    test("keeps a png another machine captured under this machine's captures, whatever the streaming policy, and refuses anything else", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb6, 0, 0, 0x0a, 0x3e]);
        const { dispatcher, frames, client } = setup({} as DeviceManager, () => false);

        await dispatcher.handle(client, request('device.importCapture', { deviceId: 'phone-1', data: Buffer.from(png).toString('base64') }));
        const reply = frames.at(-1) as { ok: true; result: { path: string; width: number; height: number } };
        expect(reply.result).toMatchObject({ width: 1206, height: 2622 });
        expect(reply.result.path.startsWith(join(home, 'device-captures', 'placed', 'phone-1-'))).toBe(true);
        expect(new Uint8Array(readFileSync(reply.result.path))).toEqual(png);

        await dispatcher.handle(client, request('device.importCapture', { deviceId: 'phone-1', data: Buffer.from('<svg/>').toString('base64') }));
        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'device-capture-failed' } });
    });

    test('passes a clipboard read and a paste with the client that asked', async () => {
        const calls: unknown[][] = [];
        const devices = {
            clipboard: (...args: unknown[]) => {
                calls.push(args);
                return Promise.resolve(args[4] === undefined ? 'on the device' : String(args[4]));
            }
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => true);
        const target = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' };

        await dispatcher.handle(client, request('device.clipboard', target));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { text: 'on the device' } });
        await dispatcher.handle(client, request('device.clipboard', { ...target, text: 'héllo', paste: true }));

        expect(calls).toEqual([
            ['simctl', 'ios', 'phone-1', 'client-1', undefined, undefined],
            ['simctl', 'ios', 'phone-1', 'client-1', 'héllo', true]
        ]);
    });

    test('starts a recording into a new file under the captures and answers that file when it stops', async () => {
        const files: string[] = [];
        const devices = {
            startRecording: (_backendId: string, _platform: string, _deviceId: string, file: string) => {
                files.push(file);
                return Promise.resolve();
            },
            stopRecording: () => Promise.resolve(files[0]!)
        } as unknown as DeviceManager;
        const { dispatcher, frames, client } = setup(devices, () => true);
        const target = { backendId: 'android', platform: 'android', deviceId: 'Pixel_9' };

        await dispatcher.handle(client, request('device.record', { ...target, mode: 'start' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { recording: true } });
        await dispatcher.handle(client, request('device.record', { ...target, mode: 'stop' }));

        expect(files[0]!.startsWith(join(home, 'device-captures', 'Pixel_9-'))).toBe(true);
        expect(files[0]!.endsWith('.mp4')).toBe(true);
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { recording: false, path: files[0] } });
    });

    test('lets a person pause an agent and read who operates what, whatever the streaming policy', async () => {
        const dispatcher = new Dispatcher();
        const control = new DeviceControl();
        registerDeviceControlHandlers(dispatcher, control);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
        control.admit(SIMULATOR, 'chat-1', { kind: 'swipe' });

        await dispatcher.handle(client, request('device.control', { backendId: 'simctl', deviceId: 'sim-1', mode: 'pause' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { backendId: 'simctl', deviceId: 'sim-1', nodeId: 'chat-1', state: 'paused' } });

        await dispatcher.handle(client, request('device.operations'));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { devices: [{ deviceId: 'sim-1', state: 'paused', step: { kind: 'swipe' } }] } });
        control.stop();
    });
});
