import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from '../fs/machine-home.ts';
import type { DeviceInfo, DeviceInput, LiveFrame, LiveFrameHeader, LiveStreamFrame } from '@ruimte/contracts';
import { DeviceError, DeviceManager, type DeviceBackend, type DeviceSource } from './manager.ts';

const phone: DeviceInfo = {
    deviceId: 'phone-1',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'shutdown',
    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
};

class FakeBackend implements DeviceBackend {
    readonly id = 'simctl';
    readonly platform = 'ios' as const;
    readonly source = new FakeSource();
    info = phone;

    list(): Promise<DeviceInfo[]> {
        return Promise.resolve([this.info]);
    }

    boot(deviceId: string): Promise<DeviceInfo> {
        return Promise.resolve({ ...phone, deviceId, state: 'booted' });
    }

    shutdown(deviceId: string): Promise<DeviceInfo> {
        return Promise.resolve({ ...phone, deviceId, state: 'shutdown' });
    }

    createSource(): DeviceSource {
        return this.source;
    }
}

class FakeSource implements DeviceSource {
    keys?: (usages: readonly number[]) => void;
    readClipboard?: () => Promise<string>;
    writeClipboard?: (text: string) => Promise<void>;
    starts = 0;
    stops = 0;
    readonly inputs: DeviceInput[] = [];
    publish: ((frame: LiveStreamFrame) => void) | null = null;

    start(publish: (frame: LiveStreamFrame) => void): Promise<void> {
        this.starts += 1;
        this.publish = publish;
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.stops += 1;
        this.publish = null;
        return Promise.resolve();
    }

    input(input: DeviceInput): void {
        this.inputs.push(input);
    }
}

describe('DeviceManager', () => {
    test('closing all also ends what each backend runs beside its sessions', () => {
        const backend = new FakeBackend();
        let closed = 0;
        Object.assign(backend, { closeAll: () => (closed += 1) });

        new DeviceManager([backend]).closeAll();

        expect(closed).toBe(1);
    });

    test('lists and controls devices through their platform backend', async () => {
        const manager = new DeviceManager([new FakeBackend()]);

        expect(await manager.list()).toEqual([phone]);
        expect(await manager.boot('simctl', 'ios', 'phone-1')).toMatchObject({ state: 'booted' });
        expect(await manager.shutdown('simctl', 'ios', 'phone-1')).toMatchObject({ state: 'shutdown' });
    });

    test('reads power through the backend, and calls it unknown where the backend has none or fails', async () => {
        const backend = new FakeBackend();
        const manager = new DeviceManager([backend]);
        expect(await manager.power('simctl', 'ios', 'phone-1')).toBeNull();

        Object.assign(backend, { power: async () => ({ level: 50, plugged: true, charging: true }) });
        expect(await manager.power('simctl', 'ios', 'phone-1')).toEqual({ level: 50, plugged: true, charging: true });

        Object.assign(backend, { power: () => Promise.reject(new DeviceError('device-not-booted', 'Start the device')) });
        expect(await manager.power('simctl', 'ios', 'phone-1')).toBeNull();
        expect(await manager.power('simctl', 'android', 'phone-1')).toBeNull();
    });

    test('names a platform that has no backend', async () => {
        const manager = new DeviceManager([new FakeBackend()]);

        await expect(manager.boot('missing', 'android', 'pixel-1')).rejects.toEqual(
            new DeviceError('platform-unavailable', 'Android devices are not available on this machine')
        );
    });

    test('keeps devices from healthy backends when another discovery backend fails', async () => {
        const unavailable: DeviceBackend = {
            id: 'coredevice',
            platform: 'ios',
            list: () => Promise.reject(new DeviceError('devicectl-unavailable', 'CoreDevice is unavailable'))
        };
        const manager = new DeviceManager([new FakeBackend(), unavailable]);

        expect(await manager.list()).toEqual([phone]);
        expect((await manager.survey()).unavailable).toEqual([{ platform: 'ios', code: 'devicectl-unavailable', message: 'CoreDevice is unavailable' }]);
        await expect(manager.boot('coredevice', 'ios', 'physical-1')).rejects.toEqual(
            new DeviceError('device-action-unavailable', 'This device cannot be started by Ruimte')
        );
    });

    test('refuses a stream to a client that cannot draw its format', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        Object.assign(backend.source, { format: 'h264' });
        const manager = new DeviceManager([backend]);
        const unsupported = new DeviceError('device-format-unsupported', 'Update Ruimte on this client to show this device');

        await expect(manager.open('simctl', 'ios', 'phone-1', 'client-old')).rejects.toEqual(unsupported);
        expect(await manager.open('simctl', 'ios', 'phone-1', 'client-new', 'http', ['jpeg', 'hevc', 'h264'])).toMatchObject({ deviceId: 'phone-1' });
        await expect(manager.open('simctl', 'ios', 'phone-1', 'client-old')).rejects.toEqual(unsupported);
    });

    test('shares one capture between event viewers and stops after the last detach', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        const manager = new DeviceManager([backend]);
        const first: Array<LiveFrameHeader<'device.frame'>> = [];
        const second: Array<LiveFrameHeader<'device.frame'>> = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'device.frame') {
                first.push(event.payload);
            }
        });
        manager.subscribe('client-2', (event) => {
            if (event.event === 'device.frame') {
                second.push(event.payload);
            }
        });

        const opened = await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events');
        const shared = await manager.open('simctl', 'ios', 'phone-1', 'client-2', 'events');
        backend.source.publish?.({ sequence: 1, width: 2, height: 3, data: new Uint8Array([1, 2, 3]) });

        expect(opened.streamId).toBe(shared.streamId);
        expect(backend.source.starts).toBe(1);
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        await manager.input('simctl', 'phone-1', 'client-1', { kind: 'button', button: 'home' });
        expect(backend.source.inputs).toEqual([{ kind: 'button', button: 'home' }]);

        manager.detach('simctl', 'phone-1', 'client-1');
        expect(backend.source.stops).toBe(0);
        manager.detach('simctl', 'phone-1', 'client-2');
        await Bun.sleep(0);
        expect(backend.source.stops).toBe(1);
    });

    test('a video frame says whether it is a key frame, and a client that lost one can ask for the next', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        let keyFrameRequests = 0;
        Object.assign(backend.source, { format: 'h264', requestKeyFrame: () => (keyFrameRequests += 1) });
        const manager = new DeviceManager([backend]);
        const frames: Array<LiveFrameHeader<'device.frame'>> = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'device.frame') {
                frames.push(event.payload);
            }
        });

        await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events', ['jpeg', 'hevc', 'h264']);
        const before = keyFrameRequests;
        backend.source.publish?.({ sequence: 1, width: 2, height: 3, format: 'h264', keyFrame: true, data: new Uint8Array([1]) });
        backend.source.publish?.({ sequence: 2, width: 2, height: 3, data: new Uint8Array([2]) });
        manager.requestKeyFrame('simctl', 'phone-1');
        manager.requestKeyFrame('simctl', 'gone');

        expect(frames.map((frame) => frame.keyFrame)).toEqual([true, undefined]);
        expect(keyFrameRequests - before).toBe(1);
        manager.closeAll();
    });

    test('a client that asked for binary frames gets the bytes, one that did not gets base64', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        Object.assign(backend.source, { format: 'h264' });
        const manager = new DeviceManager([backend]);
        const live: LiveFrame[] = [];
        const json: string[] = [];
        manager.subscribe('client-1', (event) => {
            if ('bytes' in event) {
                live.push(event);
            }
        });
        manager.subscribe('client-2', (event) => {
            if (event.event === 'device.frame' && !('bytes' in event)) {
                json.push(event.payload.data);
            }
        });

        await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events', ['jpeg', 'hevc', 'h264'], true);
        await manager.open('simctl', 'ios', 'phone-1', 'client-2', 'events', ['jpeg', 'hevc', 'h264']);
        backend.source.publish?.({ sequence: 1, width: 2, height: 3, format: 'h264', keyFrame: true, data: new Uint8Array([7, 8]) });

        expect(live).toEqual([
            {
                event: 'device.frame',
                payload: { deviceId: 'phone-1', backendId: 'simctl', platform: 'ios', sequence: 1, width: 2, height: 3, format: 'h264', keyFrame: true },
                bytes: new Uint8Array([7, 8])
            }
        ]);
        expect(json).toEqual([Buffer.from([7, 8]).toString('base64')]);
        manager.closeAll();
    });

    test('a client that subscribed again keeps its newer sink when the older one lets go', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        const manager = new DeviceManager([backend]);
        const first: Array<LiveFrameHeader<'device.frame'>> = [];
        const second: Array<LiveFrameHeader<'device.frame'>> = [];
        const off = manager.subscribe('client-1', (event) => {
            if (event.event === 'device.frame') {
                first.push(event.payload);
            }
        });
        manager.subscribe('client-1', (event) => {
            if (event.event === 'device.frame') {
                second.push(event.payload);
            }
        });
        // A socket that reattaches subscribes before the old one lets go.
        off();

        await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events');
        backend.source.publish?.({ sequence: 1, width: 2, height: 3, data: new Uint8Array([1, 2, 3]) });

        expect(first).toHaveLength(0);
        expect(second).toHaveLength(1);
    });

    test('ends the session when the last client disappears', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        const manager = new DeviceManager([backend]);
        manager.subscribe('client-1', () => undefined);
        manager.subscribe('client-2', () => undefined);

        const opened = await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events');
        await manager.open('simctl', 'ios', 'phone-1', 'client-2', 'events');

        manager.detachAll('client-1');
        expect(manager.streams.has(opened.streamId)).toBe(true);
        expect(backend.source.stops).toBe(0);

        manager.detachAll('client-2');
        await Bun.sleep(0);

        expect(manager.streams.has(opened.streamId)).toBe(false);
        expect(backend.source.stops).toBe(1);
        await expect(manager.input('simctl', 'phone-1', 'client-2', { kind: 'button', button: 'home' })).rejects.toEqual(
            new DeviceError('device-not-open', 'Open the device before sending input')
        );
    });

    test('keeps capture optional until the native helper is installed', async () => {
        const backend: DeviceBackend = {
            id: 'simctl',
            platform: 'ios',
            list: async () => [{ ...phone, state: 'booted' }],
            boot: async () => ({ ...phone, state: 'booted' }),
            shutdown: async () => phone
        };
        const manager = new DeviceManager([backend]);

        await expect(manager.open('simctl', 'ios', 'phone-1', 'client-1')).rejects.toEqual(
            new DeviceError('device-capture-unavailable', 'Device capture is not installed on this machine')
        );
    });

    test('does not attach a client when its event stream fails to start', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        backend.source.start = () => Promise.reject(new Error('capture failed'));
        const manager = new DeviceManager([backend]);

        await expect(manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events')).rejects.toEqual(new DeviceError('device-helper-failed', 'capture failed'));
        await expect(manager.input('simctl', 'phone-1', 'client-1', { kind: 'button', button: 'home' })).rejects.toEqual(
            new DeviceError('device-not-open', 'Open the device before sending input')
        );
    });

    test('finds the device a reference names by asking only the backends that could have it', async () => {
        const backend = new FakeBackend();
        let physicalLists = 0;
        const physical: DeviceBackend = {
            id: 'coredevice',
            platform: 'ios',
            kinds: ['physical'],
            list: () => {
                physicalLists += 1;
                return Promise.resolve([]);
            }
        };
        const manager = new DeviceManager([backend, physical]);

        expect(await manager.find({ platform: 'ios', kind: 'simulator', name: 'iPhone 18 Pro', runtime: 'iOS 27.0' })).toEqual(phone);
        expect(await manager.find({ platform: 'ios', kind: 'simulator', name: 'iPhone 12', runtime: 'iOS 27.0' })).toBeNull();
        expect(physicalLists).toBe(0);
    });

    test('a holder that fails to start the stream is not left holding the device', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        backend.source.start = () => Promise.reject(new Error('capture failed'));
        const manager = new DeviceManager([backend]);

        await expect(manager.hold('simctl', 'ios', 'phone-1', 'agent:chat-1')).rejects.toEqual(new DeviceError('device-helper-failed', 'capture failed'));
        await expect(manager.input('simctl', 'phone-1', 'agent:chat-1', { kind: 'button', button: 'home' })).rejects.toMatchObject({ code: 'device-not-open' });
    });

    test('takes a picture for a person through the screenshot when the backend has no capture of its own', async () => {
        const backend = new FakeBackend();
        const png = new Uint8Array([0x89, 0x50]);
        Object.assign(backend, { screenshot: () => Promise.resolve(png) });
        const manager = new DeviceManager([backend]);

        expect(await manager.capture('simctl', 'ios', 'phone-1')).toBe(png);
        await expect(manager.startRecording('simctl', 'ios', 'phone-1', '/captures/clip.mp4')).rejects.toMatchObject({ code: 'device-action-unavailable' });
    });

    test("reads and writes a backend's own clipboard, and pastes through the source's keys", async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        let clipboard = 'from the device';
        const keys: number[][] = [];
        Object.assign(backend, {
            readClipboard: () => Promise.resolve(clipboard),
            writeClipboard: (_deviceId: string, text: string) => {
                clipboard = text;
                return Promise.resolve();
            }
        });
        backend.source.keys = (usages: readonly number[]) => {
            keys.push([...usages]);
        };
        const manager = new DeviceManager([backend]);

        expect(await manager.clipboard('simctl', 'ios', 'phone-1', 'client-1')).toBe('from the device');
        expect(await manager.clipboard('simctl', 'ios', 'phone-1', 'client-1', 'mine')).toBe('mine');
        await expect(manager.clipboard('simctl', 'ios', 'phone-1', 'client-1', 'pasted', true)).rejects.toMatchObject({ code: 'device-not-open' });

        manager.subscribe('client-1', () => undefined);
        await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events');
        await manager.clipboard('simctl', 'ios', 'phone-1', 'client-1', 'pasted', true);

        expect(clipboard).toBe('pasted');
        expect(keys).toEqual([[0xe3, 0x19]]);
    });

    test("goes through an open source's clipboard when the backend has none", async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        const written: string[] = [];
        backend.source.readClipboard = () => Promise.resolve('copied on the device');
        backend.source.writeClipboard = (text: string) => {
            written.push(text);
            return Promise.resolve();
        };
        const manager = new DeviceManager([backend]);

        await expect(manager.clipboard('simctl', 'ios', 'phone-1', 'client-1')).rejects.toMatchObject({ code: 'device-not-open' });
        manager.subscribe('client-1', () => undefined);
        await manager.open('simctl', 'ios', 'phone-1', 'client-1', 'events');

        expect(await manager.clipboard('simctl', 'ios', 'phone-1', 'client-1')).toBe('copied on the device');
        await manager.clipboard('simctl', 'ios', 'phone-1', 'client-1', 'mine');
        expect(written).toEqual(['mine']);
    });

    test('refuses a path that is not absolute or that the machine does not hand out, before any backend sees it', async () => {
        const home = await mkdtemp(join(tmpdir(), 'ruimte-device-paths-'));
        const actions: unknown[] = [];
        const backend = new FakeBackend();
        Object.assign(backend, {
            action: (_deviceId: string, action: unknown) => {
                actions.push(action);
                return Promise.resolve({});
            }
        });
        const manager = new DeviceManager([backend], undefined, (path) => new MachineHome(home).refuse(path));
        const install = (path: string) => manager.action({ backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', action: 'installApp', path });

        try {
            await expect(install('build/Atlas.app')).rejects.toMatchObject({ code: 'device-path-refused' });
            await expect(install(join(home, 'projects', 'secret.app'))).rejects.toMatchObject({ code: 'device-path-refused' });
            await expect(
                manager.action({
                    backendId: 'simctl',
                    platform: 'ios',
                    deviceId: 'phone-1',
                    action: 'addMedia',
                    paths: ['/work/a.png', join(home, 'local.key')]
                })
            ).rejects.toMatchObject({ code: 'device-path-refused' });
            expect(actions).toEqual([]);

            await install(join(home, 'worktrees', 'atlas', 'build', 'Atlas.app'));
            expect(actions).toHaveLength(1);
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    });
});
