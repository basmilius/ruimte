import { describe, expect, test } from 'bun:test';
import type { DeviceFrame, DeviceInfo, DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
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
    test('lists and controls devices through their platform backend', async () => {
        const manager = new DeviceManager([new FakeBackend()]);

        expect(await manager.list()).toEqual([phone]);
        expect(await manager.boot('simctl', 'ios', 'phone-1')).toMatchObject({ state: 'booted' });
        expect(await manager.shutdown('simctl', 'ios', 'phone-1')).toMatchObject({ state: 'shutdown' });
    });

    test('names a platform that has no backend', async () => {
        const manager = new DeviceManager([new FakeBackend()]);

        await expect(manager.boot('missing', 'android', 'pixel-1')).rejects.toEqual(
            new DeviceError('platform-unavailable', 'Android simulators are not available on this machine')
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
        await expect(manager.boot('coredevice', 'ios', 'physical-1')).rejects.toEqual(
            new DeviceError('device-action-unavailable', 'This device cannot be started by Ruimte')
        );
    });

    test('shares one capture between event viewers and stops after the last detach', async () => {
        const backend = new FakeBackend();
        backend.info = { ...phone, state: 'booted' };
        const manager = new DeviceManager([backend]);
        const first: DeviceFrame[] = [];
        const second: DeviceFrame[] = [];
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
});
