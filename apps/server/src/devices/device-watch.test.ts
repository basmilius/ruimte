import { describe, expect, test } from 'bun:test';
import type { DeviceInfo, DevicePower } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import type { SessionEvent } from '../wire.ts';
import { SIMULATOR } from './device-test-helpers.ts';
import { DEVICE_WATCH_MS, DeviceWatch } from './device-watch.ts';

const PHONE: DeviceInfo = { ...SIMULATOR, deviceId: 'phone-1', kind: 'physical' };

/* The survey is async, so a turn of the timers is followed by a few turns of the queue. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve();
    }
}

function setup() {
    const timers = new ManualTimers();
    const state = { devices: [SIMULATOR] as DeviceInfo[], failure: null as Error | null, power: null as DevicePower | null, surveys: 0, powers: 0 };
    const watch = new DeviceWatch(
        {
            survey: async () => {
                state.surveys += 1;
                if (state.failure !== null) {
                    throw state.failure;
                }

                return { devices: state.devices, unavailable: [] };
            },
            power: async () => {
                state.powers += 1;

                return state.power;
            }
        },
        timers
    );
    const heard: string[] = [];
    const listen = (clientId: string): (() => void) => watch.subscribe(clientId, (event: SessionEvent) => void heard.push(`${clientId}:${event.event}`));

    return { timers, state, watch, heard, listen };
}

describe('DeviceWatch', () => {
    test('surveys nothing until a client watches, and stops when the last one lets go', async () => {
        const { timers, state, watch, listen } = setup();
        listen('client-1');
        listen('client-2');

        expect(timers.waiting).toBe(0);

        watch.watch('client-1');
        watch.watch('client-2');
        timers.advance(0);
        await settle();

        expect(state.surveys).toBe(1);

        watch.unwatch('client-1');

        expect(timers.waiting).toBe(1);

        watch.unwatch('client-2');

        expect(timers.waiting).toBe(0);
    });

    test('tells only the watching clients, and only when the devices differ from the last survey', async () => {
        const { timers, state, watch, heard, listen } = setup();
        listen('client-1');
        listen('client-2');
        watch.watch('client-1');
        timers.advance(0);
        await settle();
        heard.length = 0;
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(heard).toEqual([]);

        state.devices = [{ ...SIMULATOR, state: 'shutdown' }];
        timers.advance(DEVICE_WATCH_MS);
        await settle();
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(heard).toEqual(['client-1:device.changed']);
    });

    test('tells a client of the first survey after it watches, so a change after its own read of the list reaches it', async () => {
        const { timers, state, watch } = setup();
        let shown = state.devices;
        watch.subscribe('client-1', () => {
            shown = state.devices;
        });
        state.devices = [{ ...SIMULATOR, state: 'shutdown' }];
        watch.watch('client-1');
        timers.advance(0);
        await settle();
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(shown).toEqual([{ ...SIMULATOR, state: 'shutdown' }]);
    });

    test('tells a client that joins a running survey of the next one, and leaves the others be', async () => {
        const { timers, state, watch, heard, listen } = setup();
        listen('client-1');
        listen('client-2');
        watch.watch('client-1');
        timers.advance(0);
        await settle();
        heard.length = 0;
        state.devices = [{ ...SIMULATOR, state: 'shutdown' }];
        timers.advance(DEVICE_WATCH_MS);
        await settle();
        watch.watch('client-2');
        timers.advance(DEVICE_WATCH_MS);
        await settle();
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(heard).toEqual(['client-1:device.changed', 'client-2:device.changed']);
    });

    test('tells that the survey failed once, and again when it works', async () => {
        const { timers, state, watch, heard, listen } = setup();
        listen('client-1');
        watch.watch('client-1');
        timers.advance(0);
        await settle();
        state.failure = new Error('adb is gone');
        timers.advance(DEVICE_WATCH_MS);
        await settle();
        timers.advance(DEVICE_WATCH_MS);
        await settle();
        state.failure = null;
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(heard).toEqual(['client-1:device.changed', 'client-1:device.changed', 'client-1:device.changed']);
    });

    test('reads the battery of a phone every minute and tells when it moved', async () => {
        const { timers, state, watch, heard, listen } = setup();
        state.devices = [PHONE];
        state.power = { level: 80, plugged: false, charging: false };
        listen('client-1');
        watch.watch('client-1');
        timers.advance(0);
        await settle();

        expect(state.powers).toBe(1);

        heard.length = 0;
        state.power = { level: 79, plugged: false, charging: false };
        for (let second = 1; second < 60; second += 1) {
            timers.advance(DEVICE_WATCH_MS);
            await settle();
        }

        expect(state.powers).toBe(1);
        expect(heard).toEqual([]);

        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(state.powers).toBe(2);
        expect(heard).toEqual(['client-1:device.changed']);
    });

    test('drops a client that leaves and ends a survey that was still out', async () => {
        const { timers, state, watch, heard, listen } = setup();
        const leave = listen('client-1');
        watch.watch('client-1');
        timers.advance(0);
        leave();
        await settle();
        state.devices = [];
        timers.advance(DEVICE_WATCH_MS);
        await settle();

        expect(timers.waiting).toBe(0);
        expect(heard).toEqual([]);
    });
});
