import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { AndroidBackend } from './android.ts';
import { locateAndroidSdk } from './android-sdk.ts';
import { centerOf, flattenTree, type DeviceElement } from './device-tree.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './scrcpy-source.ts';

/*
 * Against an Android device that is already running on this machine, an emulator or a phone; booting
 * one takes longer than a test should wait. Without one the suite skips.
 */
const sdk = locateAndroidSdk();
const server = new ScrcpyServerFile(scrcpyServerDirectory(false, process.execPath, join(import.meta.dir, '..', '..')), true);
const backend = new AndroidBackend({ createSource: (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => server.path()) });
const booted = sdk === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted');

/* The adb serial of a device: a phone's id is its serial, an emulator answers its AVD name on its console. */
async function serialOf(deviceId: string): Promise<string> {
    const adb = async (arguments_: string[]): Promise<string> => new Response(Bun.spawn([sdk!.adb, ...arguments_]).stdout).text();
    for (const line of (await adb(['devices'])).split('\n')) {
        const serial = line.split('\t')[0]!;
        if (serial === deviceId || (serial.startsWith('emulator-') && (await adb(['-s', serial, 'emu', 'avd', 'name'])).split('\n')[0]!.trim() === deviceId)) {
            return serial;
        }
    }
    throw new Error(`adb does not list ${deviceId}`);
}

async function waitFor(condition: () => boolean, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) {
        await Bun.sleep(50);
    }
}

describe.skipIf(booted === undefined)('Android screen', () => {
    test('streams H.264 from a key frame, takes input and ends cleanly', async () => {
        const source = backend.createSource(booted!.deviceId);
        const frames: LiveStreamFrame[] = [];
        await source.start((frame) => frames.push(frame));
        try {
            await waitFor(() => frames.length > 0, 10_000);
            expect(frames[0]).toMatchObject({ format: 'h264', keyFrame: true });
            // A key frame starts with the SPS the reader put in front of it.
            expect(frames[0]!.data[4]! & 0x1f).toBe(7);

            const before = frames.length;
            source.input({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.8 });
            for (let step = 1; step <= 10; step += 1) {
                source.input({ kind: 'pointer', phase: 'move', x: 0.5, y: 0.8 - step * 0.05 });
                await Bun.sleep(16);
            }
            source.input({ kind: 'pointer', phase: 'up', x: 0.5, y: 0.3 });
            source.input({ kind: 'button', button: 'home' });
            await waitFor(() => frames.length > before, 5_000);
            expect(frames.length).toBeGreaterThan(before);

            const keyFrames = frames.filter((frame) => frame.keyFrame).length;
            source.requestKeyFrame?.();
            await waitFor(() => frames.filter((frame) => frame.keyFrame).length > keyFrames, 5_000);
            expect(frames.filter((frame) => frame.keyFrame).length).toBeGreaterThan(keyFrames);
        } finally {
            await source.stop();
        }
    }, 30_000);

    test('reads the elements on screen through uiautomator, in the pixels of a screencap', async () => {
        const [tree, shot] = await Promise.all([backend.tree(booted!.deviceId), backend.screenshot(booted!.deviceId)]);
        const view = new DataView(shot.buffer, shot.byteOffset);
        expect(tree.screen).toEqual({ width: view.getUint32(16), height: view.getUint32(20) });
        expect(tree.root.children.length).toBeGreaterThan(0);
    }, 30_000);

    // An emulator only: the draft goes to the emulator's own number, which a phone would really text.
    test.skipIf(booted?.kind !== 'simulator')(
        'types text in any script and with emoji into a field as it was given',
        async () => {
            const deviceId = booted!.deviceId;
            const target = { backendId: booted!.backendId, platform: booted!.platform, deviceId };
            // A draft to the emulator's own number. A Return would send it, so the text holds none, and the draft is cleared after.
            await backend.action(deviceId, { ...target, action: 'openUrl', url: 'sms:5554' });
            const field = async (): Promise<{ element: DeviceElement; screen: { width: number; height: number } } | null> => {
                for (let attempt = 0; attempt < 20; attempt += 1) {
                    const tree = await backend.tree(deviceId);
                    const element = flattenTree(tree).find((candidate) => candidate.role === 'EditText');
                    if (element) {
                        return { element, screen: tree.screen };
                    }
                    await Bun.sleep(500);
                }
                return null;
            };
            const before = await field();
            expect(before).not.toBeNull();

            const source = backend.createSource(deviceId);
            await source.start(() => undefined);
            const text = 'Grüße, Ελλάδα, привет, 日本語 and עברית 🎉👩‍💻';
            try {
                const center = centerOf(before!.element);
                const point = { x: center.x / before!.screen.width, y: center.y / before!.screen.height };
                await source.input({ kind: 'pointer', phase: 'down', ...point });
                await Bun.sleep(60);
                await source.input({ kind: 'pointer', phase: 'up', ...point });
                await Bun.sleep(1000);

                await backend.type(deviceId, text, async () => ({
                    keys: async (usages) => source.keys!(usages),
                    paste: (run) => source.paste!(run)
                }));
                let typed: string | null | undefined;
                for (let attempt = 0; attempt < 10 && typed !== text; attempt += 1) {
                    await Bun.sleep(500);
                    typed = (await field())?.element.value;
                }
                expect(typed).toBe(text);
            } finally {
                await source.stop();
                // The draft would stay in the conversation: select it all, delete it and leave.
                const serial = await serialOf(deviceId);
                await Bun.spawn([sdk!.adb, '-s', serial, 'shell', 'input keycombination 113 29; input keyevent 67; input keyevent 4; input keyevent 4']).exited;
            }
        },
        60_000
    );
});

const phone = sdk === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted' && device.kind === 'physical');

describe.skipIf(phone === undefined)('Android battery', () => {
    test('a phone says its own level and whether it is on power', async () => {
        const power = await backend.power(phone!.deviceId);
        expect(power).not.toBeNull();
        expect(power!.level).toBeGreaterThanOrEqual(0);
        expect(power!.level).toBeLessThanOrEqual(100);
        expect(power!.simulated).toBeUndefined();
    });
});
