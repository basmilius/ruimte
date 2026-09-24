import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import type { CanvasHost, Noun } from '../canvas/verb.ts';
import { verbNamed } from '../canvas/verbs.ts';
import { DeviceDriver } from './agent-driver.ts';
import { IosSimulatorBackend } from './ios-simulator.ts';
import { DeviceManager } from './manager.ts';
import { physicalStreamHelperPath } from './physical-stream-source.ts';
import { createTreeLauncher, SimulatorTreeReader } from './simulator-tree.ts';

/*
 * A simulator somebody booted already, read through the bridge a release build of this checkout left
 * in its target folder. It only reads, so it may run against a simulator a person is using.
 */
const launcher =
    process.platform === 'darwin' ? createTreeLauncher(physicalStreamHelperPath(false, process.execPath, resolve(import.meta.dir, '../../..'))) : null;
const simulators = launcher === null ? null : new IosSimulatorBackend(undefined, null, undefined, (udid) => new SimulatorTreeReader(udid, launcher));
const booted = simulators === null ? undefined : (await simulators.list().catch(() => [])).find((device) => device.state === 'booted');

const home = await mkdtemp(join(tmpdir(), 'ruimte-device-tree-'));
const manager = new DeviceManager(simulators === null ? [] : [simulators]);
const driver = new DeviceDriver({ home, manager });

afterAll(async () => {
    driver.releaseAll();
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

describe.skipIf(booted === undefined)('ruimte-context device state on a booted simulator', () => {
    test('prints the elements of the app in front, and reads them again quickly from the same bridge', async () => {
        const first = await device(['state', 'phone-1']);
        expect(first).toContain('can\ttree\tyes');
        const [, count, size] = first.find((line) => line.startsWith('elements\t'))!.split('\t');
        expect(Number(count)).toBeGreaterThan(0);
        const shot = (await device(['shot', 'phone-1']))[0]!.split('\t')[2];
        expect(size).toBe(shot);
        expect(first.find((line) => line.startsWith('tree\t'))).toMatch(/^tree\t\[0\] Application/);

        const started = performance.now();
        const second = await device(['state', 'phone-1']);
        expect(performance.now() - started).toBeLessThan(2_000);
        expect(second).toContain('can\ttree\tyes');
    }, 30_000);
});
