import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateAndroidSdk } from './android-sdk.ts';
import { AndroidBackend } from './android.ts';

/* A whole one-pixel png, which a media scanner indexes where a header alone would be refused. */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/*
 * Set RUIMTE_ANDROID_MEDIA_SERIAL to an explicitly selected spare phone's adb serial.
 * The picture stays on the phone; never discover or drive another target implicitly.
 */
const serial = process.env.RUIMTE_ANDROID_MEDIA_SERIAL;
const sdk = serial ? locateAndroidSdk() : null;
const backend = new AndroidBackend();

describe.skipIf(!serial)('media on an Android device', () => {
    test('a picture added to the device is in its media store', async () => {
        expect(sdk).not.toBeNull();
        const booted = (await backend.list()).find((device) => device.deviceId === serial && device.kind === 'physical' && device.state === 'booted');
        expect(booted).toBeDefined();
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-android-media-'));
        const name = `ruimte-media-${Date.now()}.png`;
        try {
            await writeFile(join(folder, name), PIXEL_PNG);
            await backend.action(booted!.deviceId, {
                backendId: 'android',
                platform: 'android',
                deviceId: booted!.deviceId,
                action: 'addMedia',
                paths: [join(folder, name)]
            });
            await Bun.sleep(2_000);
            const query = Bun.spawn([sdk!.adb, '-s', serial!, 'shell', 'content query --uri content://media/external/images/media --projection _display_name']);
            const output = await new Response(query.stdout).text();
            expect(await query.exited).toBe(0);
            expect(output).toContain(name);
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });
});
