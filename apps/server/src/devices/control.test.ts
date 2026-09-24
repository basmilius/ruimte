import { beforeEach, describe, expect, test } from 'bun:test';
import type { DeviceOperated } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { AGENT_HOLD_IDLE_MS, DeviceDriver } from './agent-driver.ts';
import { DeviceControl, describeStep } from './control.ts';
import { RecordingBackend, SIMULATOR } from './device-test-helpers.ts';
import { DeviceManager } from './manager.ts';

let timers: ManualTimers;
let control: DeviceControl;
let heard: DeviceOperated[];

beforeEach(() => {
    timers = new ManualTimers();
    control = new DeviceControl({ timers });
    heard = [];
    control.subscribe('client-1', (event: SessionEvent) => {
        if (event.event === 'device.operated') {
            heard.push(event.payload);
        }
    });
});

const TARGET = { backendId: SIMULATOR.backendId, deviceId: SIMULATOR.deviceId };

describe('DeviceControl', () => {
    test('tells every client what the agent does, a tap with its point and a count that tells two taps apart', () => {
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'tap', x: 0.25, y: 0.5 })).toBeNull();
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'launch', app: 'com.apple.Preferences' })).toBeNull();
        expect(heard).toEqual([
            {
                ...TARGET,
                nodeId: 'chat-1',
                state: 'running',
                step: { kind: 'tap', description: 'tap', x: 0.25, y: 0.5, seq: 0 }
            },
            {
                ...TARGET,
                nodeId: 'chat-1',
                state: 'running',
                step: { kind: 'launch', target: 'com.apple.Preferences', description: 'launch com.apple.Preferences', seq: 1 }
            }
        ]);
        expect(control.list()).toEqual([heard[1]!]);
    });

    test('describes every step in a few words', () => {
        expect(describeStep({ kind: 'button', button: 'home' })).toBe('button home');
        expect(describeStep({ kind: 'swipe' })).toBe('swipe');
        expect(describeStep({ kind: 'type' })).toBe('type');
        expect(describeStep({ kind: 'shot' })).toBe('shot');
    });

    test('refuses every step but a shot while paused, and lets the agent on again after resume', () => {
        control.admit(SIMULATOR, 'chat-1', { kind: 'shot' });
        expect(control.control(TARGET, 'pause')).toMatchObject({ state: 'paused', nodeId: 'chat-1', step: { kind: 'shot' } });
        const refusal = control.admit(SIMULATOR, 'chat-1', { kind: 'tap', x: 0.1, y: 0.1 });
        expect(refusal?.code).toBe('paused');
        expect(refusal?.message).toContain('The person paused you on iPhone');
        expect(refusal?.message).toContain('Wait a while and call again');
        expect(refusal?.message).toContain('Or stop here');
        for (const step of [{ kind: 'swipe' }, { kind: 'type' }, { kind: 'button', button: 'home' }, { kind: 'launch', app: 'x' }] as const) {
            expect(control.admit(SIMULATOR, 'chat-1', step)?.code).toBe('paused');
        }
        const before = heard.length;
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'shot' })).toBeNull();
        expect(heard.length).toBe(before);

        expect(control.control(TARGET, 'resume')).toMatchObject({ state: 'running' });
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'type' })).toBeNull();
        expect(heard.at(-1)).toMatchObject({ state: 'running', step: { kind: 'type' } });
    });

    test('keeps a take-over while the agent keeps asking, and ends it once the agent stops', () => {
        control.admit(SIMULATOR, 'chat-1', { kind: 'swipe' });
        control.control(TARGET, 'takeOver');
        timers.advance(AGENT_HOLD_IDLE_MS - 1);
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'swipe' })?.code).toBe('taken-over');
        timers.advance(AGENT_HOLD_IDLE_MS - 1);
        expect(control.list()).toMatchObject([{ state: 'takenOver' }]);
        timers.advance(1);
        expect(control.list()).toEqual([]);
        expect(heard.at(-1)).toMatchObject({ state: 'ended', nodeId: 'chat-1' });
        expect(control.admit(SIMULATOR, 'chat-1', { kind: 'swipe' })).toBeNull();
    });

    test('ends a running operation a while after the last step', () => {
        control.admit(SIMULATOR, 'chat-1', { kind: 'button', button: 'home' });
        timers.advance(AGENT_HOLD_IDLE_MS);
        expect(heard.map((payload) => payload.state)).toEqual(['running', 'ended']);
        expect(timers.waiting).toBe(0);
    });

    test('keeps a pause after the agent went quiet, until the person resumes', () => {
        control.admit(SIMULATOR, 'chat-1', { kind: 'tap', x: 0.5, y: 0.5 });
        control.control(TARGET, 'pause');
        timers.advance(AGENT_HOLD_IDLE_MS * 3);
        expect(control.list()).toMatchObject([{ state: 'paused' }]);
        expect(control.admit(SIMULATOR, 'chat-2', { kind: 'tap', x: 0.5, y: 0.5 })?.code).toBe('paused');
        timers.advance(AGENT_HOLD_IDLE_MS);
        expect(control.control(TARGET, 'resume')).toMatchObject({ state: 'ended' });
        expect(control.list()).toEqual([]);
    });

    test('answers ended for a device no agent operates, and tells nobody', () => {
        expect(control.control(TARGET, 'pause')).toEqual({ ...TARGET, nodeId: null, state: 'ended', step: null });
        expect(heard).toEqual([]);
    });

    test('is the gate a driver asks, so a paused device is never touched', async () => {
        const backend = new RecordingBackend();
        const driver = new DeviceDriver({ home: '/tmp', manager: new DeviceManager([backend]), timers, sleep: async () => undefined, gate: control });
        control.admit(SIMULATOR, 'chat-1', { kind: 'shot' });
        control.control(TARGET, 'takeOver');
        await expect(driver.button('chat-1', SIMULATOR, 'home')).rejects.toMatchObject({ code: 'taken-over' });
        expect(backend.source.inputs).toEqual([]);
        expect(backend.source.starts).toBe(0);
    });
});
