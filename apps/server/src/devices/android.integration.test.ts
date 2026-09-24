import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { AndroidBackend } from './android.ts';
import { locateAndroidSdk } from './android-sdk.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './scrcpy-source.ts';

/*
 * Against an Android device that is already running on this machine, an emulator or a phone; booting
 * one takes longer than a test should wait. Without one the suite skips.
 */
const server = new ScrcpyServerFile(scrcpyServerDirectory(false, process.execPath, join(import.meta.dir, '..', '..')), true);
const backend = new AndroidBackend({ createSource: (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => server.path()) });
const booted = locateAndroidSdk() === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted');

const waitFor = async (condition: () => boolean, ms: number): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) {
        await Bun.sleep(50);
    }
};

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
});
