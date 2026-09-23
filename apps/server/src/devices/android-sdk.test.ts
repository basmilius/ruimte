import { describe, expect, test } from 'bun:test';
import { locateAndroidSdk, type AndroidSdkEnvironment } from './android-sdk.ts';

const environment = (overrides: Partial<AndroidSdkEnvironment> & { files?: string[] }): AndroidSdkEnvironment => {
    const files = new Set(overrides.files ?? []);
    return {
        env: {},
        platform: 'darwin',
        home: '/Users/bas',
        which: () => null,
        realpath: (path) => path,
        exists: (path) => files.has(path),
        ...overrides
    };
};

describe('locateAndroidSdk', () => {
    test('finds the SDK that holds the adb on PATH when no variable names it', () => {
        const sdk = locateAndroidSdk(
            environment({
                which: (command) => (command === 'adb' ? '/usr/local/bin/adb' : null),
                realpath: () => '/Users/bas/Development/Environment/android-sdk/platform-tools/adb',
                files: ['/Users/bas/Development/Environment/android-sdk/platform-tools/adb', '/Users/bas/Development/Environment/android-sdk/emulator/emulator']
            })
        );

        expect(sdk).toEqual({
            adb: '/Users/bas/Development/Environment/android-sdk/platform-tools/adb',
            emulator: '/Users/bas/Development/Environment/android-sdk/emulator/emulator',
            avdHome: '/Users/bas/.android/avd'
        });
    });

    test('prefers ANDROID_HOME and honors a moved AVD folder', () => {
        const sdk = locateAndroidSdk(
            environment({
                env: { ANDROID_HOME: '/opt/android', ANDROID_AVD_HOME: '/data/avd' },
                files: ['/opt/android/platform-tools/adb', '/Users/bas/Library/Android/sdk/platform-tools/adb']
            })
        );

        expect(sdk).toEqual({ adb: '/opt/android/platform-tools/adb', emulator: null, avdHome: '/data/avd' });
    });

    test('falls back to the default folder of the platform', () => {
        const sdk = locateAndroidSdk(
            environment({
                platform: 'linux',
                home: '/home/bas',
                files: ['/home/bas/Android/Sdk/platform-tools/adb', '/home/bas/Android/Sdk/emulator/emulator']
            })
        );

        expect(sdk?.emulator).toBe('/home/bas/Android/Sdk/emulator/emulator');
    });

    test('keeps a lone adb on PATH that sits in no SDK, and nothing without one', () => {
        expect(locateAndroidSdk(environment({ which: () => '/opt/homebrew/bin/adb' }))).toEqual({
            adb: '/opt/homebrew/bin/adb',
            emulator: null,
            avdHome: '/Users/bas/.android/avd'
        });
        expect(locateAndroidSdk(environment({}))).toBeNull();
    });
});
