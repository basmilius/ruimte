import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { locateAndroidSdk } from './android-sdk.ts';
import { AndroidBackend } from './android.ts';
import { createDeviceHelperLauncher } from './helper-source.ts';
import { IosSimulatorBackend } from './ios-simulator.ts';
import { DeviceManager, type DeviceBackend } from './manager.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './scrcpy-source.ts';

/*
 * Folds a foldable that is already running and checks that the picture changes size with it: an
 * iPhone Duo simulator (Xcode 27.1 with the iOS 27.1 runtime) and an emulator with a hinge, such as
 * a Pixel Fold. It leaves the device folded the way the test ends, so run it on spare ones.
 */
const simulators =
    process.platform === 'darwin'
        ? new IosSimulatorBackend(undefined, createDeviceHelperLauncher([process.execPath, resolve(import.meta.dir, '../main.ts'), 'device-helper']))
        : null;
const duo =
    simulators === null
        ? undefined
        : (await simulators.list().catch(() => [])).find((device) => device.state === 'booted' && device.capabilities.tools?.includes('fold'));

const sdk = locateAndroidSdk();
const server = new ScrcpyServerFile(scrcpyServerDirectory(false, process.execPath, join(import.meta.dir, '..', '..')), true);
const emulators = new AndroidBackend({ createSource: (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => server.path()) });
const fold =
    sdk === null
        ? undefined
        : (await emulators.list().catch(() => [])).find((device) => device.state === 'booted' && device.capabilities.tools?.includes('fold'));

async function sizeAfter(manager: DeviceManager, streamId: string, frames: LiveStreamFrame[], change: () => Promise<unknown>): Promise<string> {
    await change();
    const before = frames.length;
    for (let turn = 0; turn < 100 && frames.length <= before + 5; turn += 1) {
        await Bun.sleep(100);
    }
    const last = frames.at(-1)!;
    expect(manager.streams.has(streamId)).toBe(true);
    return `${last.width}x${last.height}`;
}

async function foldTest(backend: DeviceBackend, device: NonNullable<typeof duo>): Promise<void> {
    const manager = new DeviceManager([backend]);
    const frames: LiveStreamFrame[] = [];
    manager.subscribe('test', (event) => {
        if (event.event === 'device.frame') {
            const header = event.payload as { width: number; height: number; sequence: number };
            frames.push({ ...header, data: new Uint8Array() });
        }
    });
    const opened = await manager.open(device.backendId, device.platform, device.deviceId, 'test', 'events', ['jpeg', 'hevc', 'h264']);
    try {
        const target = { backendId: device.backendId, platform: device.platform, deviceId: device.deviceId } as const;
        const closed = await sizeAfter(manager, opened.streamId, frames, () => manager.action({ ...target, action: 'setFold', value: 'closed' }));
        const open = await sizeAfter(manager, opened.streamId, frames, () => manager.action({ ...target, action: 'setFold', value: 'open' }));

        expect(closed).not.toBe(open);
    } finally {
        manager.detachAll('test');
    }
}

describe.skipIf(duo === undefined)('an iPhone Duo simulator', () => {
    test('shows the cover when closed and the inner panel when open', async () => {
        await foldTest(simulators!, duo!);
    });
});

describe.skipIf(fold === undefined)('an Android emulator with a hinge', () => {
    test('streams the new screen size after it folds and unfolds', async () => {
        await foldTest(emulators, fold!);
    });
});
