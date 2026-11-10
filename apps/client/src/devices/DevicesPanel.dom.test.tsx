import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { button, buttonWithText } from '../../testing/device-dom';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_EMULATOR, FAKE_PHONE, FAKE_SIMULATOR, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace | null = null;
let page: Mounted | null = null;

async function showPanel(list: readonly DeviceInfo[]): Promise<void> {
    machine = new FakeMachine();
    devices = answerDevices(machine, list);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'devices' }));
    await until(() => document.body.textContent?.includes(list[0].name) === true);
}

function rowOf(name: string): HTMLElement {
    const label = [...document.body.querySelectorAll<HTMLElement>('button, span')].find((element) => element.textContent === name);
    const row = label?.parentElement;
    if (!row) {
        throw new Error(`no row for ${name}`);
    }

    return row;
}

beforeEach(() => {
    workspace = null;
    page = null;
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'devices' }));
    await page?.unmount();
    workspace?.close();
    devices.restore();
});

describe('a row of the devices panel', () => {
    test('opens the device from the row itself, without a button of its own', async () => {
        await showPanel([FAKE_SIMULATOR]);
        expect(button('Open in device panel')).toBeNull();
        await clickOn(buttonWithText(FAKE_SIMULATOR.name));
        await until(() => button('Back to devices') !== null);
    });

    test('shows the version, and starts a device that is off', async () => {
        const off: DeviceInfo = { ...FAKE_EMULATOR, state: 'shutdown' };
        await showPanel([off]);
        expect(rowOf(off.name).textContent).toContain(off.runtime);
        await clickOn(button('Start device'));
        await until(() => machine.requests('device.boot').length === 1);
    });

    test('keeps the reason a device cannot be used in view, and says nothing of a version then', async () => {
        const phone: DeviceInfo = { ...FAKE_PHONE, reason: 'unauthorized' };
        await showPanel([phone]);
        const row = rowOf(phone.name);
        expect(row.querySelector('span:not(.sr-only).text-text-muted')?.textContent).toBe('Allow USB debugging on the device');
        expect(row.textContent).not.toContain(phone.runtime);
    });

    test('shows a spinner while a device changes state', async () => {
        const changing: DeviceInfo = { ...FAKE_EMULATOR, state: 'transitioning' };
        await showPanel([changing]);
        expect(rowOf(changing.name).querySelector('.animate-spin')).not.toBeNull();
    });
});
