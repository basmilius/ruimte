import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS, type ProjectView, type RequestType } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { answerDevices, FAKE_EMULATOR, FAKE_PHONE, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_PHONE.name, device: referenceOf(FAKE_PHONE) };
const EMULATOR: ProjectView = { kind: 'device', id: 'pixel', name: FAKE_EMULATOR.name, device: referenceOf(FAKE_EMULATOR) };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace | null = null;
let page: Mounted | null = null;

function toolbarText(): string {
    return document.body.querySelector('header')?.textContent ?? document.body.textContent ?? '';
}

function button(label: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

function buttonWithText(text: string): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

async function show(view: ProjectView): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [view] }, { activeViewId: view.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => button('Device tools') !== null);
}

beforeEach(() => {
    machine = new FakeMachine();
    devices = answerDevices(machine, [FAKE_PHONE, FAKE_EMULATOR]);
});

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    devices.restore();
    page = null;
    workspace = null;
});

describe("a phone's battery on its device view", () => {
    test('shows how full a phone is', async () => {
        devices.power = { level: 14, plugged: false, charging: false };
        await show(PHONE);
        await until(() => document.body.textContent?.includes('14%') === true);
        expect(machine.requests('device.power')[0]).toEqual({ backendId: 'android', platform: 'android', deviceId: 'R5CT' });
    });

    test('says a level set in the tools is simulated, and reads the real one again once it is reset', async () => {
        devices.power = { level: 15, plugged: false, charging: false, simulated: true };
        await show(PHONE);
        await until(() => document.body.textContent?.includes('15%simulated') === true);
        devices.power = { level: 82, plugged: true, charging: true, source: 'usb' };
        await clickOn(button('Device tools'));
        await until(() => buttonWithText('Reset battery') !== null);
        await clickOn(buttonWithText('Reset battery'));
        await until(() => document.body.textContent?.includes('82%') === true);
        expect(document.body.textContent).not.toContain('simulated');
    });

    test('shows nothing for an emulator, and asks an older machine nothing', async () => {
        devices.power = { level: 50, plugged: false, charging: false };
        await show(EMULATOR);
        expect(toolbarText()).not.toContain('%');
        await page!.unmount();
        workspace!.close();

        machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'device.power'));
        await show(PHONE);
        expect(machine.requests('device.power')).toHaveLength(0);
        expect(toolbarText()).not.toContain('50%');
    });
});
