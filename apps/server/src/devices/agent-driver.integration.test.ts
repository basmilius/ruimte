import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import type { CanvasHost, Noun } from '../canvas/verb.ts';
import { verbNamed } from '../canvas/verbs.ts';
import { DeviceDriver } from './agent-driver.ts';
import { createDeviceHelperLauncher } from './helper-source.ts';
import { IosSimulatorBackend } from './ios-simulator.ts';
import { DeviceManager } from './manager.ts';

/* A simulator somebody booted already: this suite never boots or shuts one down, and says so when there is none. */
const simulators =
    process.platform === 'darwin'
        ? new IosSimulatorBackend(undefined, createDeviceHelperLauncher([process.execPath, resolve(import.meta.dir, '../main.ts'), 'device-helper']))
        : null;
const booted = simulators === null ? undefined : (await simulators.list().catch(() => [])).find((device) => device.state === 'booted');

const home = await mkdtemp(join(tmpdir(), 'ruimte-device-trial-'));
const manager = new DeviceManager(simulators === null ? [] : [simulators]);
const driver = new DeviceDriver({ home, manager });

afterAll(async () => {
    driver.releaseAll();
    manager.closeAll();
    await rm(home, { recursive: true, force: true });
});

const content = (): ProjectContent => ({
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
                    device: { platform: 'ios', kind: 'simulator', name: booted?.name ?? '-', runtime: booted?.runtime ?? '-' }
                }
            ],
            texts: [],
            edges: [{ id: 'edge-1', from: 'phone-1', to: 'chat-1' }],
            layouts: []
        }
    ]
});

const host = {
    locate: () => ({ projectId: 'p1', folder: home, canvasId: 'main' }),
    read: async () => content(),
    devices: driver
} as unknown as CanvasHost;

const device = (argv: string[]) => (verbNamed('device') as Noun).run(argv, { caller: 'chat-1', host });

describe.skipIf(booted === undefined)('ruimte-context device on a booted simulator', () => {
    test('goes home, photographs it, opens Settings, scrolls and goes home again, with nobody showing the node', async () => {
        expect((await device(['button', 'phone-1', '--name', 'home']))[0]).toStartWith('done\tbutton');
        await Bun.sleep(1500);
        const [line] = await device(['shot', 'phone-1']);
        const [, path, size] = line!.split('\t');
        const [width, height] = size!.split('x').map(Number);
        expect(width).toBeGreaterThan(0);
        const start = await readFile(path!);
        const shotNow = async (): Promise<Buffer> => readFile((await device(['shot', 'phone-1']))[0]!.split('\t')[1]!);
        const swipe = (from: number, to: number) =>
            device(['swipe', 'phone-1', '--from', `${width! / 2},${height! * from}`, '--to', `${width! / 2},${height! * to}`]);

        // A Settings left on a page of its own, such as search results, has no list to scroll; a fresh one opens on the list.
        await manager
            .action({ action: 'terminateApp', appId: 'com.apple.Preferences', backendId: booted!.backendId, platform: 'ios', deviceId: booted!.deviceId })
            .catch(() => undefined);
        expect((await device(['launch', 'phone-1', '--app', 'com.apple.Preferences']))[0]).toStartWith('done\tlaunch');
        await Bun.sleep(1500);
        expect((await shotNow()).equals(start)).toBe(false);

        // One of the two moves the list whichever end it stood at, so the pictures after them differ.
        expect((await swipe(0.3, 0.8))[0]).toStartWith('done\tswipe');
        await Bun.sleep(1200);
        const towardTop = await shotNow();
        expect((await swipe(0.8, 0.3))[0]).toStartWith('done\tswipe');
        await Bun.sleep(1200);
        const scrolled = await shotNow();
        expect(scrolled.equals(towardTop)).toBe(false);

        await device(['button', 'phone-1', '--name', 'home']);
        await Bun.sleep(1500);
        const back = await shotNow();
        expect(back.equals(scrolled)).toBe(false);
    }, 60_000);
});
