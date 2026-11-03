import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DeviceInfo, ProjectContent } from '@ruimte/contracts';
import { toolAnswer, toolCall } from '../tools/tool-test-helpers.ts';
import type { CanvasHost } from '../tools/host.ts';
import { DeviceDriver } from './agent-driver.ts';
import { AndroidBackend } from './android.ts';
import { createDeviceHelperLauncher } from './helper-source.ts';
import { IosSimulatorBackend } from './ios-simulator.ts';
import { DeviceManager } from './manager.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './scrcpy-source.ts';

/* A simulator and an emulator somebody booted already: this suite never boots or shuts one down, and says so when there is none. */
const simulators =
    process.platform === 'darwin'
        ? new IosSimulatorBackend(undefined, createDeviceHelperLauncher([process.execPath, resolve(import.meta.dir, '../main.ts'), 'device-helper']))
        : null;
const screenServer = new ScrcpyServerFile(scrcpyServerDirectory(false, process.execPath, resolve(import.meta.dir, '..', '..')), true);
const emulators = new AndroidBackend({ createSource: (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => screenServer.path()) });

async function bootedOn(backend: { list(): Promise<DeviceInfo[]> } | null): Promise<DeviceInfo | undefined> {
    return backend === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted' && device.kind === 'simulator');
}

const simulator = await bootedOn(simulators);
const emulator = await bootedOn(emulators);

const home = await mkdtemp(join(tmpdir(), 'ruimte-device-trial-'));
const manager = new DeviceManager(simulators === null ? [emulators] : [simulators, emulators]);
const driver = new DeviceDriver({ home, manager });

afterAll(async () => {
    driver.releaseAll();
    manager.closeAll();
    await rm(home, { recursive: true, force: true });
});

let booted: DeviceInfo | undefined;

function content(): ProjectContent {
    return {
        name: 'trial',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'chat-1', kind: 'chat', title: 'Tester', x: 0, y: 0, w: 560, h: 360 },
                    {
                        id: 'phone-1',
                        kind: 'device',
                        title: 'Phone',
                        x: 700,
                        y: 0,
                        w: 400,
                        h: 800,
                        device: { platform: booted?.platform ?? 'ios', kind: 'simulator', name: booted?.name ?? '-', runtime: booted?.runtime ?? '-' }
                    }
                ],
                texts: [],
                edges: [{ id: 'edge-1', from: 'phone-1', to: 'chat-1' }],
                layouts: []
            }
        ]
    };
}

const host = {
    projects: {
        locate: () => ({ projectId: 'p1', folder: home, canvasId: 'main' }),
        read: async () => content(),
        machineOfNode: () => null
    },
    devices: driver
} as unknown as CanvasHost;

async function device(tool: string, input: Record<string, unknown>): Promise<string[]> {
    return (await toolAnswer(tool, { device: 'phone-1', ...input }, toolCall('chat-1', host))).lines;
}

/* The same run on each kind of device, against the Settings app of its platform. */
for (const [name, target, settings] of [
    ['a booted iOS simulator', simulator, 'com.apple.Preferences'],
    ['a booted Android emulator', emulator, 'com.android.settings']
] as const) {
    describe.skipIf(target === undefined)(`the device tools on ${name}`, () => {
        test('goes home, photographs it, opens Settings, reads it, scrolls and goes home again, with nobody showing the node', async () => {
            booted = target;
            expect((await device('device_input', { action: 'button', name: 'home' }))[0]).toStartWith('done\tbutton');
            await Bun.sleep(1500);
            const [line] = await device('device_shot', {});
            const [, path, size] = line!.split('\t');
            const [width, height] = size!.split('x').map(Number);
            expect(width).toBeGreaterThan(0);
            const start = await readFile(path!);
            const shotNow = async (): Promise<Buffer> => readFile((await device('device_shot', {}))[0]!.split('\t')[1]!);
            const swipe = (from: number, to: number) =>
                device('device_input', { action: 'swipe', from: `${width! / 2},${height! * from}`, to: `${width! / 2},${height! * to}` });

            // A Settings left on a page of its own, such as search results, has no list to scroll; a fresh one opens on the list.
            await manager
                .action({ action: 'terminateApp', appId: settings, backendId: target!.backendId, platform: target!.platform, deviceId: target!.deviceId })
                .catch(() => undefined);
            expect((await device('device_app', { action: 'launch', app: settings }))[0]).toStartWith('done\tlaunch');
            await Bun.sleep(1500);
            expect((await shotNow()).equals(start)).toBe(false);
            const state = await device('device_state', {});
            expect(state).toContain('state\tbooted');
            expect(state).toContain('can\ttype\tyes');
            // This suite gives a simulator no device bridge, so only an emulator reads its elements here.
            if (target!.platform === 'android') {
                expect(state.some((row) => row.startsWith('elements\t'))).toBe(true);
            }

            // One of the two moves the list whichever end it stood at, so the pictures after them differ.
            expect((await swipe(0.3, 0.8))[0]).toStartWith('done\tswipe');
            await Bun.sleep(1200);
            const towardTop = await shotNow();
            expect((await swipe(0.8, 0.3))[0]).toStartWith('done\tswipe');
            await Bun.sleep(1200);
            const scrolled = await shotNow();
            expect(scrolled.equals(towardTop)).toBe(false);

            await device('device_input', { action: 'button', name: 'home' });
            await Bun.sleep(1500);
            const back = await shotNow();
            expect(back.equals(scrolled)).toBe(false);
        }, 60_000);
    });
}
