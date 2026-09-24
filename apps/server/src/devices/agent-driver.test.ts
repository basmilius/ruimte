import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { AGENT_HOLD_IDLE_MS, DeviceDriver, type AgentStep, type DeviceGate } from './agent-driver.ts';
import { RecordingBackend, SIMULATOR, pngOf } from './device-test-helpers.ts';
import { DeviceManager } from './manager.ts';

let home: string;
let backend: RecordingBackend;
let manager: DeviceManager;
let timers: ManualTimers;
let slept: number[];
let gate: DeviceGate;
let admitted: { caller: string; step: AgentStep }[];
let driver: DeviceDriver;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-device-driver-'));
    backend = new RecordingBackend();
    manager = new DeviceManager([backend]);
    timers = new ManualTimers();
    slept = [];
    gate = { admit: () => null };
    admitted = [];
    driver = new DeviceDriver({
        home,
        manager,
        timers,
        sleep: async (ms) => {
            slept.push(ms);
        },
        gate: {
            admit: (device, caller, step) => {
                admitted.push({ caller, step });
                return gate.admit(device, caller, step);
            }
        }
    });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DeviceDriver', () => {
    test('writes a shot under the home folder and counts later coordinates in its pixels', async () => {
        backend.shot = pngOf(1000, 2000);
        const shot = await driver.shot('chat-1', SIMULATOR, 'phone-node');
        expect(shot).toMatchObject({ width: 1000, height: 2000 });
        expect(shot.path.startsWith(join(home, 'screenshots', 'phone-node-'))).toBe(true);
        expect(await readFile(shot.path)).toEqual(Buffer.from(backend.shot));
        expect(driver.screen(SIMULATOR)).toEqual({ width: 1000, height: 2000 });

        await driver.tap('chat-1', SIMULATOR, { x: 250, y: 500 });
        expect(backend.source.inputs).toEqual([
            { kind: 'pointer', phase: 'down', x: 0.25, y: 0.25 },
            { kind: 'pointer', phase: 'up', x: 0.25, y: 0.25 }
        ]);
        expect(slept).toEqual([60]);
    });

    test('refuses a coordinate before any shot, and one outside the last shot', async () => {
        await expect(driver.tap('chat-1', SIMULATOR, { x: 1, y: 1 })).rejects.toMatchObject({ code: 'no-shot' });
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        await expect(driver.tap('chat-1', SIMULATOR, { x: 1206, y: 10 })).rejects.toMatchObject({ code: 'outside-shot' });
        expect(backend.source.starts).toBe(0);
    });

    test('a swipe presses, moves a frame at a time over its duration and lets go at the end', async () => {
        backend.shot = pngOf(100, 100);
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        await driver.swipe('chat-1', SIMULATOR, { x: 50, y: 80 }, { x: 50, y: 20 }, 64);
        const inputs = backend.source.inputs;
        expect(inputs[0]).toEqual({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.8 });
        expect(inputs.at(-1)).toEqual({ kind: 'pointer', phase: 'up', x: 0.5, y: 0.2 });
        expect(inputs.filter((input) => input.kind === 'pointer' && input.phase === 'move')).toHaveLength(4);
        expect(inputs.at(-2)).toMatchObject({ phase: 'move', y: 0.2 });
        expect(slept).toEqual([16, 16, 16, 16]);
    });

    test('holds a session without any client, which a client opening the device shares', async () => {
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        await driver.button('chat-1', SIMULATOR, 'home');
        expect(backend.source.starts).toBe(1);
        expect(backend.source.inputs).toEqual([{ kind: 'button', button: 'home' }]);

        const opened = await manager.open('simctl', 'ios', 'sim-1', 'client-1');
        await driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 });
        expect(backend.source.starts).toBe(1);
        manager.detachAll('client-1');
        await settle();
        expect(backend.source.stops).toBe(0);
        expect(opened.streamId).toStartWith('device:');
    });

    test('lets go of the device a minute after the last call, and a new call takes it again', async () => {
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        await driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 });
        timers.advance(AGENT_HOLD_IDLE_MS - 1);
        await driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 });
        timers.advance(AGENT_HOLD_IDLE_MS - 1);
        await settle();
        expect(backend.source.stops).toBe(0);

        timers.advance(1);
        await settle();
        expect(backend.source.stops).toBe(1);
        await expect(manager.input('simctl', 'sim-1', 'agent:chat-1', { kind: 'button', button: 'home' })).rejects.toMatchObject({ code: 'device-not-open' });

        await driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 });
        expect(backend.source.starts).toBe(2);
    });

    test('keeps a client session running when the agent lets go', async () => {
        await manager.open('simctl', 'ios', 'sim-1', 'client-1', 'events');
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        await driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 });
        driver.releaseAll();
        await settle();
        expect(backend.source.stops).toBe(0);
        expect(timers.waiting).toBe(0);
        manager.detachAll('client-1');
        await settle();
        expect(backend.source.stops).toBe(1);
    });

    test('passes every gesture and launch through the gate, and nothing reaches the device past a refusal', async () => {
        await driver.shot('chat-1', SIMULATOR, 'phone-node');
        gate = { admit: (device) => (device.deviceId === 'sim-1' ? { code: 'paused', message: 'The person paused this device' } : null) };
        await expect(driver.tap('chat-1', SIMULATOR, { x: 10, y: 10 })).rejects.toMatchObject({ code: 'paused' });
        await expect(driver.launch('chat-1', SIMULATOR, 'com.example.app')).rejects.toMatchObject({ code: 'paused' });
        expect(backend.source.starts).toBe(0);
        expect(backend.actions).toEqual([]);
        expect(admitted).toEqual([
            { caller: 'chat-1', step: { kind: 'shot' } },
            { caller: 'chat-1', step: { kind: 'tap', x: 10 / 1206, y: 10 / 2622 } },
            { caller: 'chat-1', step: { kind: 'launch', app: 'com.example.app' } }
        ]);
    });

    test('refuses input on a device that takes none, and says what works', async () => {
        const readOnly = { ...SIMULATOR, capabilities: { ...SIMULATOR.capabilities, input: false } };
        backend.info = readOnly;
        await driver.shot('chat-1', readOnly, 'phone-node');
        await expect(driver.tap('chat-1', readOnly, { x: 10, y: 10 })).rejects.toMatchObject({ code: 'device-input-unavailable' });
        expect(driver.abilities(readOnly)).toEqual({ shot: true, input: false, type: false, launch: true });
        expect(driver.abilities({ ...SIMULATOR, state: 'shutdown' })).toEqual({ shot: false, input: false, type: false, launch: false });
    });

    test('opens an app through the device tools', async () => {
        await driver.launch('chat-1', SIMULATOR, 'com.example.app');
        expect(backend.actions).toEqual([{ action: 'launchApp', appId: 'com.example.app', backendId: 'simctl', platform: 'ios', deviceId: 'sim-1' }]);
    });

    test('types through a session it holds, which lets go a minute later like any other call', async () => {
        await driver.type('chat-1', SIMULATOR, 'Grüße');
        expect(backend.typed).toEqual(['Grüße']);
        expect(backend.source.chords).toEqual([[0xe3, 0x19]]);
        expect(driver.abilities(SIMULATOR).type).toBe(true);
        timers.advance(AGENT_HOLD_IDLE_MS);
        await settle();
        expect(backend.source.stops).toBe(1);
    });

    test('refuses to type where the backend has no way to, or the gate says no', async () => {
        const readOnly = { ...SIMULATOR, capabilities: { ...SIMULATOR.capabilities, input: false } };
        await expect(driver.type('chat-1', readOnly, 'hi')).rejects.toMatchObject({ code: 'device-input-unavailable' });
        gate = { admit: () => ({ code: 'taken-over', message: 'The person took this device over' }) };
        await expect(driver.type('chat-1', SIMULATOR, 'hi')).rejects.toMatchObject({ code: 'taken-over' });
        expect(backend.typed).toEqual([]);
    });
});
