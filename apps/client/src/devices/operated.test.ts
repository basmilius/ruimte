import { afterEach, describe, expect, test } from 'bun:test';
import type { DeviceAgentStep, DeviceOperated, EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { WatchablePool } from '@/transport/pool-watch';
import type { Transport, TransportStatus } from '@/transport/transport';
import { startDeviceOperatedWatch, stepWords, stripLook, tapPoint, useDeviceOperated } from './operated';

const step = (kind: string, more: Partial<DeviceAgentStep> = {}): DeviceAgentStep => ({ kind, description: kind, seq: 1, ...more });

const operated = (state: DeviceOperated['state'], more: Partial<DeviceOperated> = {}): DeviceOperated => ({
    backendId: 'simctl',
    deviceId: 'sim-1',
    nodeId: 'chat-1',
    state,
    step: step('tap', { x: 0.5, y: 0.25 }),
    ...more
});

describe('the words of the strip', () => {
    test('follow the last step while the agent operates the device', () => {
        expect(stepWords(step('tap'), 'ios')).toBe('Tapping');
        expect(stepWords(step('swipe'), 'ios')).toBe('Swiping');
        expect(stepWords(step('type'), 'ios')).toBe('Typing');
        expect(stepWords(step('shot'), 'ios')).toBe('Looking');
        expect(stepWords(step('launch', { target: 'com.apple.Preferences' }), 'ios')).toBe('Opening com.apple.Preferences');
        expect(stepWords(step('button', { target: 'home' }), 'ios')).toBe('Pressing Home');
        expect(stepWords(step('button', { target: 'swipeHome' }), 'ios')).toBe('Swiping home');
    });

    test('name the buttons of an Android device its own way', () => {
        expect(stepWords(step('button', { target: 'lock' }), 'ios')).toBe('Pressing Lock');
        expect(stepWords(step('button', { target: 'lock' }), 'android')).toBe('Pressing Power');
        expect(stepWords(step('button', { target: 'appSwitcher' }), 'android')).toBe('Opening recent apps');
        expect(stepWords(step('button', { target: 'volumeUp' }), 'android')).toBe('Pressing volumeUp');
    });

    test('read a step this client does not know as the machine described it', () => {
        expect(stepWords(step('pinch', { description: 'pinch out' }), 'ios')).toBe('pinch out');
    });

    test('offer pause and take over while the agent acts, and resume while the person holds the device', () => {
        expect(stripLook(operated('running'), 'ios')).toEqual({ words: 'Tapping', tone: 'accent', actions: ['pause', 'takeOver'] });
        expect(stripLook(operated('paused'), 'ios')).toEqual({ words: 'Paused', tone: 'muted', actions: ['resume'] });
        expect(stripLook(operated('takenOver'), 'ios')).toEqual({ words: 'You have control', tone: 'muted', actions: ['resume'] });
        expect(stripLook(operated('running', { step: null }), 'ios').words).toBe('Working');
    });
});

describe('the point of a tap', () => {
    test('lands on the drawn screen in whole pixels, and only for a tap', () => {
        const screen = { left: 10, top: 20, width: 201, height: 400 };
        expect(tapPoint(step('tap', { x: 0.5, y: 0.25 }), screen)).toEqual({ x: 111, y: 120 });
        expect(tapPoint(step('swipe'), screen)).toBeNull();
        expect(tapPoint(null, screen)).toBeNull();
    });
});

class FakeLink implements Transport {
    status: TransportStatus = 'open';
    standing: DeviceOperated[] = [];
    private readonly handlers = new Map<string, Set<(payload: never) => void>>();

    async request<T extends RequestType>(type: T): Promise<RequestMap[T]['result']> {
        if (type === 'device.operations') {
            return { devices: this.standing } as RequestMap[T]['result'];
        }
        throw new Error(`not asked here: ${type}`);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const handlers = this.handlers.get(event) ?? new Set();
        handlers.add(handler as (payload: never) => void);
        this.handlers.set(event, handlers);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        this.handlers.get(event)?.forEach((handler) => handler(payload as never));
    }
}

const poolOf = (links: Record<string, FakeLink>): WatchablePool => ({
    ids: () => Object.keys(links),
    peek: (endpointId) => links[endpointId] ?? null,
    subscribe: () => () => undefined
});

const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 5; turn++) {
        await Promise.resolve();
    }
};

const stops: (() => void)[] = [];
afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
});

const devicesOf = (endpointId: string) => Object.values(useDeviceOperated.getState().byEndpoint[endpointId] ?? {});

describe('the devices agents operate', () => {
    test('are asked for once the socket is open, follow every step, and drop a device once the agent let go', async () => {
        const link = new FakeLink();
        link.standing = [operated('paused')];
        stops.push(startDeviceOperatedWatch(poolOf({ 'machine-1': link })));
        await settle();
        expect(devicesOf('machine-1').map((entry) => entry.state)).toEqual(['paused']);

        link.emit('device.operated', operated('running', { step: step('swipe', { seq: 2 }) }));
        expect(devicesOf('machine-1')).toMatchObject([{ state: 'running', step: { kind: 'swipe' } }]);

        link.emit('device.operated', operated('ended'));
        expect(devicesOf('machine-1')).toEqual([]);
    });

    test('are forgotten with the socket', async () => {
        const link = new FakeLink();
        link.standing = [operated('running')];
        stops.push(startDeviceOperatedWatch(poolOf({ 'machine-2': link })));
        await settle();
        expect(devicesOf('machine-2')).toHaveLength(1);
        stops.pop()?.();
        expect(useDeviceOperated.getState().byEndpoint['machine-2']).toBeUndefined();
    });
});
