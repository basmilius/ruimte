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
                capabilities: { boot: false, shutdown: false, stream: true, input: false, screenshot: true }
            }
        ]);
        expect(calls[0]).toContain("properties.hardware.platform = 'iOS' AND properties.hardware.reality = 'physical'");
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
});
