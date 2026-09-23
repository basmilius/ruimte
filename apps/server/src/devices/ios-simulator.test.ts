import { describe, expect, test } from 'bun:test';
import { IosSimulatorBackend, type SimctlRunner } from './ios-simulator.ts';

const listOutput = JSON.stringify({
    devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
            { udid: 'phone-1', isAvailable: true, state: 'Shutdown', name: 'iPhone 18 Pro' },
            { udid: 'phone-old', isAvailable: false, state: 'Shutdown', name: 'Old iPhone' }
        ],
        'com.apple.CoreSimulator.SimRuntime.tvOS-27-0': [{ udid: 'tv-1', isAvailable: true, state: 'Booted', name: 'Apple TV' }]
    }
});

describe('IosSimulatorBackend', () => {
    test('reads available iOS devices and excludes other CoreSimulator platforms', async () => {
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }));

        expect(await backend.list()).toEqual([
            {
                deviceId: 'phone-1',
                backendId: 'simctl',
                platform: 'ios',
                kind: 'simulator',
                name: 'iPhone 18 Pro',
                runtime: 'iOS 27.0',
                state: 'shutdown',
                capabilities: expect.objectContaining({
                    boot: true,
                    shutdown: true,
                    stream: false,
                    input: false,
                    screenshot: true,
                    buttons: ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri']
                })
            }
        ]);
    });

    test('boots by udid and reads the resulting state', async () => {
        const calls: string[][] = [];
        let booted = false;
        const run: SimctlRunner = async (arguments_) => {
            calls.push(arguments_);
            if (arguments_[0] === 'boot') {
                booted = true;
            }
            const stdout = booted ? listOutput.replace('"state":"Shutdown"', '"state":"Booted"') : listOutput;
            return { exitCode: 0, stdout: arguments_[0] === 'list' ? stdout : '', stderr: '' };
        };
        const backend = new IosSimulatorBackend(run);

        expect(await backend.boot('phone-1')).toMatchObject({ deviceId: 'phone-1', state: 'booted' });
        expect(calls).toEqual([
            ['list', 'devices', 'available', '--json'],
            ['boot', 'phone-1'],
            ['list', 'devices', 'available', '--json']
        ]);
    });

    test('turns a failed command into a stable device error', async () => {
        let call = 0;
        const backend = new IosSimulatorBackend(async () => {
            call += 1;
            return call === 1
                ? { exitCode: 0, stdout: listOutput.replace('"state":"Shutdown"', '"state":"Booted"'), stderr: '' }
                : { exitCode: 1, stdout: '', stderr: 'No devices are booted.' };
        });

        await expect(backend.shutdown('phone-1')).rejects.toMatchObject({ code: 'simctl-failed', message: 'No devices are booted.' });
    });

    test('reads display and accessibility settings', async () => {
        const backend = new IosSimulatorBackend(async (arguments_) => {
            const option = arguments_.at(-1);
            const stdout =
                option === 'appearance'
                    ? 'dark\n'
                    : option === 'content_size'
                      ? 'accessibility-large\n'
                      : option === 'increase_contrast'
                        ? 'enabled\n'
                        : option === 'status'
                          ? '{"reduce-motion":"on","reduce-transparency":"off","show-borders":"on","voiceover":"off","liquid-glass":"tinted","color-filter":"grayscale"}\n'
                          : '';
            return { exitCode: 0, stdout, stderr: '' };
        });

        expect(await backend.detail('phone-1')).toEqual({
            appearance: 'dark',
            textSize: 'extra-large',
            increaseContrast: true,
            reduceMotion: true,
            reduceTransparency: false,
            showBorders: true,
            voiceOver: false,
            liquidGlass: 'tinted',
            colorFilter: 'grayscale'
        });
    });

    test('runs a typed action and reads the resulting settings', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            const stdout = arguments_.at(-1) === 'appearance' ? 'light\n' : arguments_.at(-1) === 'content_size' ? 'large\n' : '';
            return { exitCode: 0, stdout, stderr: '' };
        });

        await backend.action('phone-1', {
            backendId: 'simctl',
            platform: 'ios',
            deviceId: 'phone-1',
            action: 'setLocation',
            latitude: 52.3676,
            longitude: 4.9041
        });

        expect(calls[0]).toEqual(['location', 'phone-1', 'set', '52.3676,4.9041']);
    });
});
