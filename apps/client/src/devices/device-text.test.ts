import { describe, expect, test } from 'bun:test';
import type { DeviceUnavailable } from '@ruimte/contracts';
import { deviceStateText, unavailableNotes } from './device-text';

const phone = { platform: 'android', kind: 'physical', state: 'shutdown' } as const;

describe('deviceStateText', () => {
    test('says what a phone needs from the person before it can be used', () => {
        expect(deviceStateText({ ...phone, reason: 'unauthorized' })).toBe('Allow USB debugging on the device');
        expect(deviceStateText({ ...phone, reason: 'offline' })).toBe('Offline');
    });

    test('falls back to the state for a reason it does not know', () => {
        expect(deviceStateText({ ...phone, reason: 'recovery' })).toBe('Unavailable');
        expect(deviceStateText({ ...phone, state: 'booted' })).toBe('Connected');
        expect(deviceStateText({ platform: 'ios', kind: 'physical', state: 'booted' })).toBe('Paired');
        expect(deviceStateText({ platform: 'android', kind: 'simulator', state: 'booted' })).toBe('Running');
    });
});

describe('unavailableNotes', () => {
    const adb: DeviceUnavailable = { platform: 'android', code: 'adb-unavailable', message: 'adb was not found' };
    const simctl: DeviceUnavailable = { platform: 'ios', code: 'simctl-unavailable', message: 'xcrun was not found' };
    const devicectl: DeviceUnavailable = { platform: 'ios', code: 'devicectl-unavailable', message: 'devicectl was not found' };

    test('translates the codes it knows and says Xcode once', () => {
        expect(unavailableNotes([adb, simctl, devicectl], 'darwin')).toEqual([
            'The Android SDK was not found on this machine. Install it to use Android emulators and devices.',
            'Install Xcode to use iOS simulators and iPhones.'
        ]);
    });

    test('passes on the message of a code it does not know', () => {
        expect(unavailableNotes([{ platform: 'android', code: 'adb-too-old', message: 'adb 1.0.39 is too old' }], 'darwin')).toEqual(['adb 1.0.39 is too old']);
    });

    test('tells a machine without macOS that iOS needs a Mac instead of Xcode', () => {
        expect(unavailableNotes([simctl], 'linux')).toEqual(['iOS simulators need a Mac.']);
        expect(unavailableNotes([], 'linux')).toEqual(['iOS simulators need a Mac.']);
        expect(unavailableNotes([], null)).toEqual([]);
    });
});
