import { afterEach, describe, expect, test } from 'bun:test';
import type { DeviceInfo, ProjectView } from '@ruimte/contracts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_EMULATOR, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

function foldable(device: DeviceInfo): DeviceInfo {
    return { ...device, capabilities: { ...device.capabilities, tools: [...(device.capabilities.tools ?? []), 'fold'] } };
}

function menuRows(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((row) => row.textContent?.trim() ?? '');
}

async function openFoldMenu(device: DeviceInfo): Promise<void> {
    machine = new FakeMachine();
    devices = answerDevices(machine, [device]);
    const view: ProjectView = { kind: 'device', id: 'phone', name: device.name, device: referenceOf(device) };
    workspace = await openFakeWorkspace(machine, { views: [view] }, { activeViewId: view.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => document.querySelector('button[aria-label="Fold"]') !== null);
    await clickOn(document.querySelector('button[aria-label="Fold"]'));
    await until(() => menuRows().includes('Closed'));
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('folding a device', () => {
    test('offers the five poses of an iPhone Duo and folds it to the one picked', async () => {
        await openFoldMenu(foldable(FAKE_SIMULATOR));

        expect(menuRows()).toEqual(['Closed', 'Tent', 'Tabletop', 'Book', 'Open']);
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) => row.textContent?.trim() === 'Tabletop') ?? null);
        await until(() => machine.requests('device.action').length === 1);

        expect(machine.requests('device.action')[0]).toMatchObject({ action: 'setFold', value: 'tabletop' });
    });

    test('offers an Android emulator closed and open only', async () => {
        await openFoldMenu(foldable(FAKE_EMULATOR));

        expect(menuRows()).toEqual(['Closed', 'Open']);
    });
});
