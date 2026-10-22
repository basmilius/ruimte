import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { answerDevices, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };
const TARGET = { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

function menuRow(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) => row.textContent?.trim() === label) ?? null;
}

function eraseDialog(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => dialog.textContent?.includes('Erase iPhone 18 Pro?')) ?? null;
}

function dialogButton(label: string): HTMLElement | null {
    return [...(eraseDialog()?.querySelectorAll<HTMLElement>('button') ?? [])].find((button) => button.textContent?.trim() === label) ?? null;
}

/* The device requests that change it, in the order they went. */
function lifecycle(): string[] {
    return machine.sent
        .filter((request) => request.type === 'device.shutdown' || request.type === 'device.boot' || request.type === 'device.action')
        .map((request) => (request.type === 'device.action' ? (request.payload as { action: string }).action : request.type));
}

async function openMore(): Promise<void> {
    await until(() => document.querySelector('button[aria-label="More device actions"]') !== null);
    await clickOn(document.querySelector('button[aria-label="More device actions"]'));
}

beforeEach(async () => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('restarting and erasing a device', () => {
    test('restarts a device by shutting it down and starting it again', async () => {
        await openMore();
        await until(() => menuRow('Restart') !== null);
        await clickOn(menuRow('Restart'));
        await until(() => lifecycle().length === 2);

        expect(lifecycle()).toEqual(['device.shutdown', 'device.boot']);
    });

    test('asks before it erases, then shuts the device down, erases it and starts it again', async () => {
        await openMore();
        await until(() => menuRow('Erase…') !== null);
        await clickOn(menuRow('Erase…'));
        await until(() => eraseDialog() !== null);

        expect(eraseDialog()!.textContent).toContain('Deletes every app, its data and the settings on iPhone 18 Pro');
        expect(lifecycle()).toEqual([]);

        await clickOn(dialogButton('Erase'));
        await until(() => lifecycle().length === 3);

        expect(lifecycle()).toEqual(['device.shutdown', 'erase', 'device.boot']);
        expect(machine.requests('device.action')).toEqual([{ ...TARGET, action: 'erase' }] as never);
        await until(() => eraseDialog() === null);
    });
});
