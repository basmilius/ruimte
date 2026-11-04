import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DeviceAction } from '@ruimte/contracts';
import { FakeRecorder, pngOf } from './device-test-helpers.ts';
import { DeviceHelperSource } from './helper-source.ts';
import { IosSimulatorBackend, type SimctlRunner } from './ios-simulator.ts';
import { SimulatorCamera } from './simulator-camera.ts';
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

    test('is ready once simctl says its boot finished, which comes after it lists the simulator as booted', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: arguments_[0] === 'list' ? listOutput.replace('"state":"Shutdown"', '"state":"Booted"') : '', stderr: '' };
        });

        expect(await backend.ready('phone-1')).toMatchObject({ deviceId: 'phone-1', state: 'booted' });
        expect(calls).toEqual([
            ['bootstatus', 'phone-1'],
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
            colorFilter: 'grayscale',
            recording: false
        });
    });

    test('runs a typed action as its simctl command', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: '', stderr: '' };
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
        expect(basename(calls[0]!.at(-1)!)).toBe('screen.png');
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

        await backend.type('phone-1', 'Grüße 🎉\r\nnext\tlast', async () => ({
            keys: async (usages) => {
                events.push(`keys ${usages.join(',')}`);
            },
            paste: () => Promise.reject(new Error('a simulator pastes through simctl'))
        }));
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

    test('records with simctl and ends it with an interrupt, which is what makes simctl finish the file', async () => {
        const recorder = new FakeRecorder();
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: '', stderr: '' }), null, undefined, null, recorder.recordings());

        await backend.startRecording('phone-1', '/captures/phone-1.mp4');

        expect(recorder.commands).toEqual([['xcrun', 'simctl', 'io', 'phone-1', 'recordVideo', '--codec=h264', '--force', '/captures/phone-1.mp4']]);
        expect((await backend.detail('phone-1')).recording).toBe(true);
        expect(await backend.stopRecording('phone-1')).toBe('/captures/phone-1.mp4');
        expect(recorder.signals).toEqual(['SIGINT']);
        expect((await backend.detail('phone-1')).recording).toBe(false);
    });

    test('ends a recording a person forgot after ten minutes and keeps its file', async () => {
        const recorder = new FakeRecorder();
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: '', stderr: '' }), null, undefined, null, recorder.recordings());
        await backend.startRecording('phone-1', '/captures/phone-1.mp4');

        recorder.pass(10 * 60 * 1000);
        await Promise.resolve();

        expect(recorder.signals).toEqual(['SIGINT']);
        expect(await backend.detail('phone-1')).toMatchObject({ recording: true, recordingEnded: true });
        await expect(backend.startRecording('phone-1', '/captures/phone-2.mp4')).rejects.toMatchObject({ code: 'device-recording' });
        expect(await backend.stopRecording('phone-1')).toBe('/captures/phone-1.mp4');
    });

    test('announces capture and recording among its tools', async () => {
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }));
        const [phone] = await backend.list();

        expect(phone!.capabilities.tools).toEqual(expect.arrayContaining(['capture', 'record', 'clipboard']));
        // Keys go through the native helper, which this backend was made without.
        expect(phone!.capabilities.tools).not.toContain('keyboard');
    });

    test('reads the clipboard with pbpaste and writes it through pbcopy on stdin', async () => {
        const calls: Array<[string[], string | undefined]> = [];
        const backend = new IosSimulatorBackend(async (arguments_, stdin) => {
            calls.push([arguments_, stdin]);
            return { exitCode: 0, stdout: arguments_[0] === 'pbpaste' ? 'Grüße 🎉' : '', stderr: '' };
        });

        expect(await backend.readClipboard('phone-1')).toBe('Grüße 🎉');
        await backend.writeClipboard('phone-1', 'from my Mac');

        expect(calls).toEqual([
            [['pbpaste', 'phone-1'], undefined],
            [['pbcopy', 'phone-1'], 'from my Mac']
        ]);
    });

    test('erases a simulator only once it is shut down', async () => {
        const calls: string[][] = [];
        let state = 'Booted';
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: arguments_[0] === 'list' ? listOutput.replace('"state":"Shutdown"', `"state":"${state}"`) : '', stderr: '' };
        });
        const erase = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', action: 'erase' } as const;

        await expect(backend.action('phone-1', erase)).rejects.toMatchObject({ code: 'device-must-be-shut-down' });
        state = 'Shutdown';
        expect(await backend.action('phone-1', erase)).toEqual({});

        expect(calls.filter((call) => call[0] !== 'list')).toEqual([['erase', 'phone-1']]);
    });

    test('runs the status bar, battery, biometric, shake and permission tools as their exact simctl commands', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: '', stderr: '' };
        });
        const target = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' } as const;
        const act = async (action: Record<string, unknown>) => {
            calls.length = 0;
            const settings = await backend.action('phone-1', { ...target, ...action } as DeviceAction);
            return { calls: calls.filter((call) => (call[0] !== 'ui' && call[0] !== 'spawn') || call[2] === 'notifyutil'), settings };
        };

        expect(await act({ action: 'setStatusBar', value: 'clean' })).toMatchObject({
            calls: [
                [
                    'status_bar',
                    'phone-1',
                    'override',
                    '--time',
                    '9:41',
                    '--dataNetwork',
                    'wifi',
                    '--wifiMode',
                    'active',
                    '--wifiBars',
                    '3',
                    '--cellularMode',
                    'active',
                    '--cellularBars',
                    '4',
                    '--batteryState',
                    'charged',
                    '--batteryLevel',
                    '100'
                ]
            ],
            settings: { statusBar: 'clean' }
        });
        expect((await act({ action: 'setBattery', level: 40, charging: true })).calls).toEqual([
            ['status_bar', 'phone-1', 'override', '--batteryLevel', '40', '--batteryState', 'charging']
        ]);
        expect((await act({ action: 'setBattery', level: 40, charging: true })).settings.battery).toEqual({ level: 40, charging: true });
        const reset = await act({ action: 'resetBattery' });
        expect(reset.calls[0]).toEqual(['status_bar', 'phone-1', 'clear']);
        expect(reset.calls[1]!.slice(0, 5)).toEqual(['status_bar', 'phone-1', 'override', '--time', '9:41']);
        expect(reset.settings.battery).toBeUndefined();
        expect((await act({ action: 'setStatusBar', value: 'default' })).calls).toEqual([['status_bar', 'phone-1', 'clear']]);
        const enroll = await act({ action: 'biometric', sensor: 'face', event: 'enroll' });
        expect(enroll.calls).toEqual([
            ['spawn', 'phone-1', 'notifyutil', '-s', 'com.apple.BiometricKit.enrollmentChanged', '1'],
            ['spawn', 'phone-1', 'notifyutil', '-p', 'com.apple.BiometricKit.enrollmentChanged']
        ]);
        expect(enroll.settings.biometricEnrolled).toBe(true);
        expect((await act({ action: 'biometric', sensor: 'face', event: 'unenroll' })).calls[0]).toEqual([
            'spawn',
            'phone-1',
            'notifyutil',
            '-s',
            'com.apple.BiometricKit.enrollmentChanged',
            '0'
        ]);
        expect((await act({ action: 'biometric', sensor: 'face', event: 'match' })).calls).toEqual([
            ['spawn', 'phone-1', 'notifyutil', '-p', 'com.apple.BiometricKit_Sim.pearl.match']
        ]);
        expect((await act({ action: 'biometric', sensor: 'finger', event: 'nomatch' })).calls).toEqual([
            ['spawn', 'phone-1', 'notifyutil', '-p', 'com.apple.BiometricKit_Sim.fingerTouch.nomatch']
        ]);
        expect((await act({ action: 'shake' })).calls).toEqual([['spawn', 'phone-1', 'notifyutil', '-p', 'com.apple.UIKit.SimulatorShake']]);
        expect((await act({ action: 'setAllPermissions', appId: 'com.example.app', decision: 'grant' })).calls).toEqual([
            ['privacy', 'phone-1', 'grant', 'all', 'com.example.app']
        ]);
    });

    test('warns of low memory through the helper of a simulator someone has open, and says to open it otherwise', async () => {
        const backend = new IosSimulatorBackend(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
        const target = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', action: 'memoryWarning' } as const;
        const called: unknown[] = [];
        const session = Object.assign(Object.create(DeviceHelperSource.prototype) as DeviceHelperSource, {
            call: async (call: unknown) => {
                called.push(call);
                return undefined;
            }
        });

        await expect(backend.action('phone-1', target, null)).rejects.toMatchObject({ code: 'device-not-open' });
        await backend.action('phone-1', target, session);
        expect(called).toEqual([{ method: 'memoryWarning' }]);
    });

    test('installs an .app and adds pictures and videos with simctl, and says an .ipa is for an iPhone', async () => {
        const calls: string[][] = [];
        const backend = new IosSimulatorBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: '', stderr: '' };
        });
        const target = { backendId: 'simctl', platform: 'ios', deviceId: 'phone-1' } as const;

        await backend.action('phone-1', { ...target, action: 'installApp', path: '/work/atlas/build/Atlas.app/' });
        await backend.action('phone-1', { ...target, action: 'addMedia', paths: ['/work/atlas/a.HEIC', '/work/atlas/b.mov'] });

        expect(calls.filter((call) => call[0] === 'install' || call[0] === 'addmedia')).toEqual([
            ['install', 'phone-1', '/work/atlas/build/Atlas.app/'],
            ['addmedia', 'phone-1', '/work/atlas/a.HEIC', '/work/atlas/b.mov']
        ]);
        await expect(backend.action('phone-1', { ...target, action: 'installApp', path: '/work/atlas/Atlas.ipa' })).rejects.toThrow('an .ipa is for an iPhone');
        await expect(backend.action('phone-1', { ...target, action: 'addMedia', paths: ['/work/atlas/notes.txt'] })).rejects.toMatchObject({
            code: 'device-path-refused'
        });
    });

    test('announces fold on an iPhone Duo and folds it through the helper of an open session', async () => {
        const duoList = JSON.stringify({
            devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-27-1': [
                    {
                        udid: 'duo-1',
                        isAvailable: true,
                        state: 'Booted',
                        name: 'iPhone Duo',
                        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'
                    },
                    {
                        udid: 'phone-1',
                        isAvailable: true,
                        state: 'Booted',
                        name: 'iPhone 18 Pro',
                        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro'
                    }
                ]
            }
        });
        const backend = new IosSimulatorBackend(
            async (arguments_) => ({ exitCode: 0, stdout: arguments_[0] === 'list' ? duoList : '', stderr: '' }),
            () => {
                throw new Error('not started in this test');
            },
            undefined,
            null,
            undefined,
            () => ({ start: () => undefined, stop: async () => undefined })
        );
        const [duo, phone] = await backend.list();
        expect(duo!.capabilities.tools).toContain('fold');
        expect(phone!.capabilities.tools).not.toContain('fold');

        const calls: unknown[] = [];
        const session = Object.assign(Object.create(DeviceHelperSource.prototype) as DeviceHelperSource, {
            call: async (call: { method: string }) => {
                calls.push(call);
                return call.method === 'preferredScreenSize' ? undefined : true;
            }
        });
        const settings = await backend.action('duo-1', { backendId: 'simctl', platform: 'ios', deviceId: 'duo-1', action: 'setFold', value: 'tent' }, session);

        expect(calls).toEqual([
            { method: 'isFoldable' },
            { method: 'pose', name: 'tent', fromDegrees: 180 },
            { method: 'preferredScreenSize', width: 1398, height: 2034 }
        ]);
        expect(settings).toMatchObject({ hinge: 80, panel: 'cover' });
    });

    test('announces the camera only with its helper, and hands the choice to it', async () => {
        const chosen: unknown[] = [];
        const camera = new SimulatorCamera(
            '/Users/bas/.ruimte',
            {
                files: { helper: 'helper', injector: 'injector' },
                spawn: () => ({ kill: () => undefined }),
                listening: async () => true,
                send: async () => true
            },
            async () => ({ exitCode: 0, stderr: '' })
        );
        camera.set = async (...arguments_: unknown[]) => {
            chosen.push(arguments_);
        };
        const run: SimctlRunner = async () => ({ exitCode: 0, stdout: listOutput, stderr: '' });
        const withCamera = new IosSimulatorBackend(run, null, undefined, null, undefined, undefined, camera);

        expect((await withCamera.list())[0]?.capabilities.tools).toContain('camera');
        expect((await new IosSimulatorBackend(run).list())[0]?.capabilities.tools).not.toContain('camera');
        await withCamera.action('phone-1', {
            backendId: 'simctl',
            platform: 'ios',
            deviceId: 'phone-1',
            action: 'setCamera',
            appId: 'com.example.scan',
            source: 'file',
            path: '/Users/bas/Code/app/qr.png'
        });
        expect(chosen).toEqual([['phone-1', 'com.example.scan', 'file', '/Users/bas/Code/app/qr.png']]);
    });
});
