import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entitlementsFor } from './sign.cjs';

const APP = '/out/mac-arm64/Ruimte.app';

function keysOf(file: string): string[] {
    return [...readFileSync(file, 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1] ?? '').sort();
}

test('the app and every Electron helper get JIT and the microphone, and no other weakening of the hardened runtime', () => {
    expect(entitlementsFor(`${APP}/Contents/Frameworks/Ruimte Helper (Renderer).app/Contents/MacOS/Ruimte Helper (Renderer)`)).toBeNull();
    expect(keysOf(join(import.meta.dir, 'entitlements.mac.plist'))).toEqual(['com.apple.security.cs.allow-jit', 'com.apple.security.device.audio-input']);
});

test('only the daemon turns off library validation, for the native addons of what it runs as Bun', () => {
    const daemon = entitlementsFor(`${APP}/Contents/Resources/bin/ruimte`);

    expect(daemon).toBe(join(import.meta.dir, 'entitlements.daemon.plist'));
    expect(keysOf(daemon ?? '')).toEqual([
        'com.apple.security.cs.allow-jit',
        'com.apple.security.cs.disable-library-validation',
        'com.apple.security.device.audio-input'
    ]);
    expect(entitlementsFor(`${APP}/Contents/Resources/bin/native/speech-bridge`)).toBeNull();
});

test('the computer use helper keeps its own entitlements', () => {
    expect(entitlementsFor(`${APP}/Contents/Helpers/Ruimte Computer Use.app/Contents/MacOS/Ruimte Computer Use`)).toBe(
        join(import.meta.dir, '..', '..', 'computer-use', 'Resources', 'entitlements.plist')
    );
});
