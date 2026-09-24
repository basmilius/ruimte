import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { pngOf } from './device-test-helpers.ts';
import { IosSimulatorBackend, type SimctlRunner } from './ios-simulator.ts';
import type { SimulatorTreeReader } from './simulator-tree.ts';

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

    test('photographs the screen through simctl into a file of its own and hands back the png', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            await writeFile(arguments_.at(-1)!, pngOf(1206, 2622));
            return { exitCode: 0, stdout: '', stderr: '' };
        });

        expect(await backend.screenshot('phone-1')).toEqual(pngOf(1206, 2622));
        expect(calls[0]!.slice(0, 4)).toEqual(['io', 'phone-1', 'screenshot', '--type=png']);
        expect(calls[0]!.at(-1)).toEndWith('/screen.png');
    });

    test('pastes text through the pasteboard, a newline as Return, waiting after each paste', async () => {
        const events: string[] = [];
        const backend = new IosSimulatorBackend(
            async (arguments_, stdin) => {
                events.push(`${arguments_.join(' ')} <${stdin}>`);
                return { exitCode: 0, stdout: '', stderr: '' };
            },
            null,
            async (ms) => {
                events.push(`sleep ${ms}`);
            }
        );

        await backend.type('phone-1', 'Grüße 🎉\r\nnext\tlast', async () => async (usages) => {
            events.push(`keys ${usages.join(',')}`);
        });
        expect(events).toEqual([
            'pbcopy phone-1 <Grüße 🎉>',
            'keys 227,25',
            'sleep 150',
            'keys 40',
            'pbcopy phone-1 <next>',
            'keys 227,25',
            'sleep 150',
            'keys 43',
            'pbcopy phone-1 <last>',
            'keys 227,25',
            'sleep 150'
        ]);
    });

    test('reads a tree through one reader per simulator, kept until it is closed', async () => {
        const made: string[] = [];
        let closed = 0;
        const backend = new IosSimulatorBackend(
            async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }),
            null,
            undefined,
            (udid) => {
                made.push(udid);
                return {
                    read: async () => ({
                        type: 'tree',
                        id: 1,
                        scale: 2,
                        root: {
                            role: 'AXApplication',
                            subrole: null,
                            label: 'Maps',
                            value: null,
                            identifier: null,
                            frame: { x: 0, y: 0, width: 400, height: 800 },
                            enabled: true,
                            children: []
                        },
                        truncated: false,
                        ms: 20
                    }),
                    close: () => {
                        closed += 1;
                    }
                } as unknown as SimulatorTreeReader;
            }
        );
        expect((await backend.tree('phone-1')).screen).toEqual({ width: 800, height: 1600 });
        await backend.tree('phone-1');
        expect(made).toEqual(['phone-1']);
        backend.closeTree('phone-1');
        backend.closeTree('phone-1');
        expect(closed).toBe(1);
        await backend.tree('phone-1');
        expect(made).toEqual(['phone-1', 'phone-1']);
    });

    test('says a tree needs the device bridge where it is not installed', async () => {
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }));
        await expect(backend.tree('phone-1')).rejects.toMatchObject({ code: 'device-tree-unavailable' });
    });
});
