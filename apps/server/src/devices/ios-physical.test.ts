import { describe, expect, test } from 'bun:test';
import { IosPhysicalBackend } from './ios-physical.ts';

const listOutput = JSON.stringify({
    info: { jsonVersion: 5, outcome: 'success' },
    result: {
        devices: [
            {
                identifier: 'coredevice-phone-1',
                properties: {
                    connection: { pairingState: 'paired', state: 'disconnected', transportType: 'localNetwork' },
                    hardware: { platform: 'iOS', reality: 'physical', deviceType: 'iPhone', udid: 'hardware-phone-1', marketingName: 'iPhone 18 Pro' },
                    software: { osVersionNumber: { stringValue: '27.2' } },
                    state: { bootState: 'booted', name: 'Test iPhone', developerModeStatus: { enabled: { mode: 1 } } }
                }
            }
        ]
    }
});

describe('IosPhysicalBackend', () => {
    test('maps paired physical iOS devices without exposing lifecycle controls', async () => {
        const calls: string[][] = [];
        const backend = new IosPhysicalBackend(
            async (arguments_) => {
                calls.push(arguments_);
                return { exitCode: 0, stdout: listOutput, stderr: '' };
            },
            async (_deviceId, sequence) => ({ sequence, width: 1320, height: 2868, data: new Uint8Array([0xff, 0xd8, 0xff]) })
        );

        expect(await backend.list()).toEqual([
            {
                deviceId: 'coredevice-phone-1',
                backendId: 'coredevice',
                platform: 'ios',
                kind: 'physical',
                name: 'Test iPhone',
                runtime: 'iOS 27.2',
                state: 'booted',
                capabilities: { boot: false, shutdown: false, stream: true, input: false, screenshot: true, tools: ['capture', 'installApp'] }
            }
        ]);
        expect(calls[0]).toContain("properties.hardware.platform = 'iOS' AND properties.hardware.reality = 'physical'");
    });

    test("reads a phone's battery through the bridge by its hardware udid, and calls anything else unknown", async () => {
        const asked: string[] = [];
        const answers: Array<() => string> = [
            () => '{"level":94,"charging":false,"plugged":false}\n',
            () => '{"level":94}\n',
            () => {
                throw new Error('the device did not say its battery in time');
            }
        ];
        const list = async () => ({ exitCode: 0, stdout: listOutput, stderr: '' });
        const backend = new IosPhysicalBackend(list, undefined, null, undefined, async (udid) => {
            asked.push(udid);
            return answers.shift()!();
        });

        expect(await backend.power('coredevice-phone-1')).toBeNull();
        await backend.list();
        expect(await backend.power('coredevice-phone-1')).toEqual({ level: 94, charging: false, plugged: false });
        expect(await backend.power('coredevice-phone-1')).toBeNull();
        expect(await backend.power('coredevice-phone-1')).toBeNull();
        expect(asked).toEqual(['hardware-phone-1', 'hardware-phone-1', 'hardware-phone-1']);
        expect(await new IosPhysicalBackend(list).power('coredevice-phone-1')).toBeNull();
    });

    test('keeps unpaired devices visible without claiming screenshot support', async () => {
        const output = listOutput.replace('"paired"', '"unpaired"');
        const backend = new IosPhysicalBackend(async () => ({ exitCode: 0, stdout: output, stderr: '' }));

        expect(await backend.list()).toMatchObject([{ state: 'shutdown', capabilities: { stream: false, screenshot: false } }]);
    });

    test('does not expose capture when Developer Mode is disabled', async () => {
        const output = listOutput.replace('"mode":1', '"mode":0');
        const backend = new IosPhysicalBackend(async () => ({ exitCode: 0, stdout: output, stderr: '' }));

        expect(await backend.list()).toMatchObject([{ state: 'booted', capabilities: { stream: false, screenshot: false } }]);
    });

    test('turns invalid JSON into a stable device error', async () => {
        const backend = new IosPhysicalBackend(async () => ({ exitCode: 0, stdout: 'not json', stderr: '' }));

        await expect(backend.list()).rejects.toMatchObject({ code: 'invalid-devicectl-output' });
    });

    test('prefers the native HEVC stream when the bridge is available', async () => {
        const source = {
            format: 'hevc' as const,
            start: async () => undefined,
            stop: async () => undefined,
            input: () => undefined
        };
        const targets: string[][] = [];
        const backend = new IosPhysicalBackend(
            async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }),
            async (_deviceId, sequence) => ({ sequence, width: 1320, height: 2868, data: new Uint8Array([0xff, 0xd8, 0xff]) }),
            (deviceId, udid) => {
                targets.push([deviceId, udid]);
                return source;
            }
        );

        await backend.list();

        expect(backend.createSource('coredevice-phone-1')).toBe(source);
        expect(targets).toEqual([['coredevice-phone-1', 'hardware-phone-1']]);
        expect(await backend.list()).toMatchObject([{ capabilities: { input: true } }]);
    });

    test('photographs the screen at its own resolution through the capture it was given', async () => {
        const shots: string[] = [];
        const backend = new IosPhysicalBackend(
            async () => ({ exitCode: 0, stdout: listOutput, stderr: '' }),
            undefined,
            null,
            async (deviceId) => {
                shots.push(deviceId);
                return new Uint8Array([0x89, 0x50]);
            }
        );

        expect(await backend.screenshot('coredevice-phone-1')).toEqual(new Uint8Array([0x89, 0x50]));
        expect(shots).toEqual(['coredevice-phone-1']);
    });

    test('installs an .app or an .ipa through devicectl and refuses everything else', async () => {
        const calls: string[][] = [];
        const backend = new IosPhysicalBackend(async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: '', stderr: '' };
        });
        const target = { backendId: 'coredevice', platform: 'ios', deviceId: 'coredevice-phone-1' } as const;

        await backend.action('coredevice-phone-1', { ...target, action: 'installApp', path: '/work/atlas/build/Atlas.ipa' });
        expect(calls).toEqual([['device', 'install', 'app', '--device', 'coredevice-phone-1', '/work/atlas/build/Atlas.ipa']]);
        await expect(backend.action('coredevice-phone-1', { ...target, action: 'installApp', path: '/work/atlas/app.apk' })).rejects.toMatchObject({
            code: 'device-path-refused'
        });
        await expect(backend.action('coredevice-phone-1', { ...target, action: 'shake' })).rejects.toMatchObject({ code: 'device-action-unavailable' });
    });
});
