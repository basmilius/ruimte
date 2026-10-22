import { spyOn } from 'bun:test';
import type { DeviceInfo, DevicePower, DeviceReference, DeviceSettings } from '@ruimte/contracts';
import type { FakeMachine } from './fake-machine';

/* A running simulator that announces every tool a person drives from the node. */
export const FAKE_SIMULATOR: DeviceInfo = {
    deviceId: 'C0FFEE00-1111-2222-3333-444455556666',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'booted',
    capabilities: {
        boot: true,
        shutdown: true,
        stream: true,
        input: true,
        screenshot: true,
        buttons: ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri', 'volumeUp', 'volumeDown', 'power'],
        tools: [
            'openUrl',
            'launchApp',
            'terminateApp',
            'appearance',
            'permissions',
            'push',
            'capture',
            'record',
            'clipboard',
            'keyboard',
            'statusBar',
            'battery',
            'biometrics',
            'shake',
            'memoryWarning',
            'installApp',
            'addMedia',
            'erase',
            'camera'
        ],
        permissions: ['camera', 'photos']
    }
};

/* A running emulator with the tools Android has. */
export const FAKE_EMULATOR: DeviceInfo = {
    deviceId: 'Pixel_9_API_36',
    backendId: 'android',
    platform: 'android',
    kind: 'simulator',
    name: 'Pixel 9',
    runtime: 'API 36',
    state: 'booted',
    capabilities: {
        boot: true,
        shutdown: true,
        stream: true,
        input: true,
        screenshot: true,
        buttons: ['back', 'home', 'appSwitcher', 'lock', 'volumeUp', 'volumeDown', 'power', 'playPause'],
        tools: ['openUrl', 'launchApp', 'terminateApp', 'appearance', 'permissions', 'capture', 'record', 'clipboard', 'keyboard', 'statusBar', 'battery', 'erase'],
        permissions: ['camera', 'photos']
    }
};

/* An Android phone on wireless debugging, the one kind with a battery of its own. */
export const FAKE_PHONE: DeviceInfo = {
    ...FAKE_EMULATOR,
    deviceId: 'R5CT',
    kind: 'physical',
    name: 'Galaxy S26',
    capabilities: { ...FAKE_EMULATOR.capabilities, boot: false, shutdown: false }
};

export function referenceOf(device: DeviceInfo): DeviceReference {
    return { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime };
}

export interface FakeDevices {
    /* What the last `device.detail` and `device.action` answer with. */
    settings: DeviceSettings;
    /* What `device.power` answers for a phone. */
    power: DevicePower | null;
    /* What the device clipboard holds, which a write replaces. */
    clipboard: string;
    recording: boolean;
    /* The machine files the page read, by path. */
    read: string[];
    restore(): void;
}

/*
 * Answers every `device.*` request on a fake machine as one machine with these devices would. The
 * screen itself never streams: the page's fetch of it is held, so a test sees what goes over the wire.
 * A file the page reads from the machine answers four bytes of a png.
 */
export function answerDevices(machine: FakeMachine, devices: readonly DeviceInfo[] = [FAKE_SIMULATOR, FAKE_EMULATOR]): FakeDevices {
    const state: FakeDevices = { settings: {}, power: null, clipboard: '', recording: false, read: [], restore: () => undefined };
    const find = (deviceId: string): DeviceInfo => {
        const device = devices.find((candidate) => candidate.deviceId === deviceId);
        if (device === undefined) {
            throw new Error(`No fake device ${deviceId}`);
        }
        return device;
    };
    const target = (payload: { backendId: string; platform: DeviceInfo['platform']; deviceId: string }) => ({
        backendId: payload.backendId,
        platform: payload.platform,
        deviceId: payload.deviceId
    });
    machine.answer('device.list', () => ({ devices: [...devices] }));
    machine.answer('device.open', (payload) => ({ ...find(payload.deviceId), streamId: `device:${payload.deviceId}` }));
    machine.answer('device.boot', (payload) => ({ ...find(payload.deviceId), state: 'booted' as const }));
    machine.answer('device.shutdown', (payload) => ({ ...find(payload.deviceId), state: 'shutdown' as const }));
    machine.answer('device.detail', (payload) => ({ ...target(payload), settings: { ...state.settings, recording: state.recording } }));
    machine.answer('device.action', (payload) => ({ ...target(payload), settings: { ...state.settings, recording: state.recording } }));
    machine.answer('device.input', () => ({}));
    machine.answer('device.power', (payload) => ({ power: find(payload.deviceId).kind === 'physical' ? state.power : null }));
    machine.answer('device.capture', (payload) => ({ path: `/home/.ruimte/device-captures/${payload.deviceId}-1.png`, width: 1206, height: 2622 }));
    machine.answer('device.record', (payload) => {
        state.recording = payload.mode === 'start';
        return payload.mode === 'start' ? { recording: true } : { recording: false, path: `/home/.ruimte/device-captures/${payload.deviceId}-1.mp4` };
    });
    machine.answer('device.clipboard', (payload) => {
        if (payload.text !== undefined) {
            state.clipboard = payload.text;
        }
        return { text: state.clipboard };
    });
    const original = globalThis.fetch;
    const held = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/fs/file?')) {
            const path = new URL(url).searchParams.get('path') ?? '';
            state.read.push(path);
            return Promise.resolve(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'application/octet-stream' } }));
        }
        if (!url.includes('/live-stream/')) {
            return original(input, init);
        }
        return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
    }) as typeof fetch);
    state.restore = () => held.mockRestore();
    return state;
}
