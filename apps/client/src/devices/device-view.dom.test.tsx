import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { mount, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
    useEndpoints.getState().setDirect('fake-machine', true);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('a device view', () => {
    test('opens the device it names and paints its event frame through the image API', async () => {
        await until(() => machine.requests('device.open').length > 0);

        expect(machine.requests('device.open')[0]).toMatchObject({ backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId });
        await until(() => page.host.querySelector(`canvas[aria-label="${FAKE_SIMULATOR.name} screen"]`) !== null);
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
        const bitmap = { close: mock(() => {}) } as unknown as ImageBitmap;
        const decoded: Blob[] = [];
        const drawImage = mock(() => {});
        const context = spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
        Object.defineProperty(globalThis, 'createImageBitmap', {
            configurable: true,
            value: async (blob: Blob) => {
                decoded.push(blob);
                return bitmap;
            }
        });
        try {
            await act(async () =>
                machine.emit('device.frame', {
                    backendId: 'simctl',
                    platform: 'ios',
                    deviceId: FAKE_SIMULATOR.deviceId,
                    sequence: 1,
                    width: 320,
                    height: 640,
                    data: '/9j/2Q=='
                })
            );
            await until(() => drawImage.mock.calls.length === 1);
            const canvas = page.host.querySelector('canvas')!;
            expect([canvas.width, canvas.height]).toEqual([320, 640]);
            expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 320, 640);
            expect(decoded).toHaveLength(1);
            expect(new Uint8Array(await decoded[0]!.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
            expect(bitmap.close).toHaveBeenCalledTimes(1);
        } finally {
            context.mockRestore();
            if (previous) {
                Object.defineProperty(globalThis, 'createImageBitmap', previous);
            } else {
                Reflect.deleteProperty(globalThis, 'createImageBitmap');
            }
        }
    });
});
