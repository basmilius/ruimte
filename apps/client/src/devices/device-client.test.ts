import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { DeviceInfo, EventMap, EventType, LiveFrameHeader, RequestMap, RequestType } from '@ruimte/contracts';
import type { LiveFrameHandler, Transport, TransportStatus } from '@/transport/transport';
import { DeviceClient } from './device-client';
import { powerKey, useDevicePowers } from './device-power';
import { useDevices } from './state';

const phone: DeviceInfo = {
    deviceId: 'phone-1',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'booted',
    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
};

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    streamId = 'device:stream-1';
    unavailable = [{ platform: 'android' as const, code: 'adb-unavailable', message: 'adb was not found' }];
    readonly calls: Array<{ type: RequestType; payload: unknown }> = [];
    private readonly eventHandlers = new Map<EventType, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (type === 'device.list') {
            return { devices: [phone], unavailable: this.unavailable } as RequestMap[T]['result'];
        }
        if (type === 'device.open') {
            return { ...phone, streamId: this.streamId } as RequestMap[T]['result'];
        }
        if (type === 'device.boot') {
            return phone as RequestMap[T]['result'];
        }
        if (type === 'device.shutdown') {
            return { ...phone, state: 'shutdown' } as RequestMap[T]['result'];
        }
        if (type === 'device.power') {
            return { power: { level: 14, plugged: false, charging: false } } as RequestMap[T]['result'];
        }
        if (type === 'device.detail' || type === 'device.action') {
            return {
                backendId: phone.backendId,
                platform: phone.platform,
                deviceId: phone.deviceId,
                settings: { appearance: 'dark' }
            } as RequestMap[T]['result'];
        }
        return {} as RequestMap[T]['result'];
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const handlers = this.eventHandlers.get(event) ?? new Set();
        handlers.add(handler as (payload: unknown) => void);
        this.eventHandlers.set(event, handlers);
        return () => handlers.delete(handler as (payload: unknown) => void);
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            handler(payload);
        }
    }

    setStatus(status: TransportStatus): void {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }
}

// A transport that reads live frames, so a client asks for its pictures in binary.
class LiveTransport extends FakeTransport {
    private readonly liveHandlers = new Set<LiveFrameHandler<'device.frame'>>();

    onLiveFrame<E extends 'device.frame' | 'browser.frame'>(event: E, handler: LiveFrameHandler<E>): () => void {
        if (event !== 'device.frame') {
            return () => undefined;
        }
        const live = handler as unknown as LiveFrameHandler<'device.frame'>;
        this.liveHandlers.add(live);
        return () => this.liveHandlers.delete(live);
    }

    emitLive(header: LiveFrameHeader<'device.frame'>, bytes: Uint8Array): void {
        for (const handler of this.liveHandlers) {
            handler(header, bytes);
        }
    }
}

beforeEach(() => useDevices.setState({ byEndpoint: {} }));
afterEach(() => jest.useRealTimers());

describe('DeviceClient', () => {
    test('discovers devices and applies lifecycle changes to the machine row', async () => {
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);

        await client.refresh();
        expect(useDevices.getState().byEndpoint['machine-1']?.devices).toEqual([phone]);
        expect(useDevices.getState().byEndpoint['machine-1']?.unavailable).toEqual(transport.unavailable);
        await client.shutdown(phone);
        expect(useDevices.getState().byEndpoint['machine-1']?.devices[0]?.state).toBe('shutdown');
        client.dispose();
    });

    test('polls external lifecycle changes while watched and stops after the last watcher', async () => {
        jest.useFakeTimers();
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);
        const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
        const stopFirst = client.watch();
        const stopSecond = client.watch();
        await settle();
        expect(transport.calls.filter((call) => call.type === 'device.list')).toHaveLength(1);

        jest.advanceTimersByTime(1_000);
        await settle();
        expect(transport.calls.filter((call) => call.type === 'device.list')).toHaveLength(2);

        stopFirst();
        jest.advanceTimersByTime(1_000);
        await settle();
        expect(transport.calls.filter((call) => call.type === 'device.list')).toHaveLength(3);

        stopSecond();
        jest.advanceTimersByTime(1_000);
        await settle();
        expect(transport.calls.filter((call) => call.type === 'device.list')).toHaveLength(3);
        client.dispose();
    });

    test("reads a phone's power at once and once a minute while watched, again after a fake level, and never on an older machine", async () => {
        jest.useFakeTimers();
        const transport = new FakeTransport();
        Object.assign(transport, { connection: { features: ['device.power'] } });
        const client = new DeviceClient('machine-1', transport);
        const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
        const reads = (): number => transport.calls.filter((call) => call.type === 'device.power').length;
        const stopFirst = client.watchPower(phone);
        const stopSecond = client.watchPower(phone);
        await settle();
        expect(reads()).toBe(1);
        expect(useDevicePowers.getState()[powerKey('machine-1', phone)]).toEqual({ level: 14, plugged: false, charging: false });

        jest.advanceTimersByTime(60_000);
        await settle();
        expect(reads()).toBe(2);

        await client.action({
            backendId: phone.backendId,
            platform: phone.platform,
            deviceId: phone.deviceId,
            action: 'setBattery',
            level: 50,
            charging: true
        });
        await settle();
        expect(reads()).toBe(3);

        stopFirst();
        stopSecond();
        jest.advanceTimersByTime(60_000);
        await settle();
        expect(reads()).toBe(3);
        client.dispose();

        const older = new FakeTransport();
        const stop = new DeviceClient('machine-2', older).watchPower(phone);
        await settle();
        expect(older.calls.some((call) => call.type === 'device.power')).toBe(false);
        stop();
    });

    test('shares one remote attachment between two mounted surfaces', async () => {
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);

        expect(await client.open(phone)).toBe('device:stream-1');
        expect(await client.open(phone)).toBe('device:stream-1');
        expect(transport.calls.filter((call) => call.type === 'device.open')).toHaveLength(1);
        await client.detach(phone);
        expect(transport.calls.some((call) => call.type === 'device.detach')).toBe(false);
        await client.detach(phone);
        expect(transport.calls.at(-1)?.type).toBe('device.detach');
        client.dispose();
    });

    test('delivers event frames and restores the event stream after reconnect', async () => {
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);
        const frames: number[][] = [];
        const stop = client.onFrame(phone, (frame) => frames.push([...frame.data]));

        await client.open(phone, 'events');
        transport.emit('device.frame', {
            deviceId: phone.deviceId,
            backendId: phone.backendId,
            platform: phone.platform,
            sequence: 1,
            width: 1179,
            height: 2556,
            data: 'AQID'
        });
        expect(frames).toEqual([[1, 2, 3]]);

        transport.setStatus('closed');
        transport.setStatus('open');
        await Promise.resolve();
        expect(transport.calls).toContainEqual({
            type: 'device.open',
            payload: { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'events', formats: ['jpeg', 'hevc', 'h264'] }
        });
        stop();
        client.dispose();
    });

    test('asks for binary frames over a transport that reads them, and draws their bytes', async () => {
        const transport = new LiveTransport();
        const client = new DeviceClient('machine-1', transport);
        const frames: number[][] = [];
        const stop = client.onFrame(phone, (frame) => frames.push([...frame.data]));

        await client.open(phone, 'events');
        transport.emitLive(
            { deviceId: phone.deviceId, backendId: phone.backendId, platform: phone.platform, sequence: 1, width: 1179, height: 2556 },
            new Uint8Array([4, 5])
        );

        expect(frames).toEqual([[4, 5]]);
        expect(transport.calls).toContainEqual({
            type: 'device.open',
            payload: { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'events', binary: true, formats: ['jpeg', 'hevc', 'h264'] }
        });
        stop();
        client.dispose();
    });

    test('publishes a replaced HTTP stream id after reconnect', async () => {
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);
        const streamIds: string[] = [];
        const stop = client.onStream(phone, (streamId) => streamIds.push(streamId));

        await client.open(phone);
        transport.streamId = 'device:stream-2';
        transport.setStatus('closed');
        transport.setStatus('open');
        await Bun.sleep(0);

        expect(streamIds).toEqual(['device:stream-1', 'device:stream-2']);
        stop();
        client.dispose();
    });

    test('routes simulator details and actions through their typed requests', async () => {
        const transport = new FakeTransport();
        const client = new DeviceClient('machine-1', transport);

        expect((await client.detail(phone)).settings.appearance).toBe('dark');
        expect(
            (
                await client.action({
                    backendId: phone.backendId,
                    platform: phone.platform,
                    deviceId: phone.deviceId,
                    action: 'setAppearance',
                    value: 'dark'
                })
            ).settings.appearance
        ).toBe('dark');
        expect(transport.calls.slice(-2)).toEqual([
            { type: 'device.detail', payload: { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' } },
            {
                type: 'device.action',
                payload: { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', action: 'setAppearance', value: 'dark' }
            }
        ]);
        client.dispose();
    });
});
