import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { DeviceError, type DeviceManager } from '../devices/manager.ts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerDeviceHandlers } from './device.ts';

const request = (type: string, payload: unknown = {}): string => JSON.stringify({ id: type, type, payload });

const setup = (devices: DeviceManager, allowed: () => boolean) => {
    const dispatcher = new Dispatcher();
    registerDeviceHandlers(dispatcher, devices, allowed);
    const frames: ServerFrame[] = [];
    const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
    return { dispatcher, frames, client };
};

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
});
