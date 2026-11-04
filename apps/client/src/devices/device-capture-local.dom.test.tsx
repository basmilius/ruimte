import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS, type RequestType } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { button, phoneCanvas } from '../../testing/device-dom';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_SIMULATOR, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MAIN = phoneCanvas();

let here: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

async function openTools(): Promise<void> {
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => button('Device tools') !== null);
    await clickOn(button('Device tools'));
    await until(() => button('Place screenshot on canvas') !== null);
}

beforeEach(() => {
    here = new FakeMachine();
    devices = answerDevices(here);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('a screenshot of a device on the machine of the project', () => {
    test('is kept apart from the passing captures before a view of it goes on the canvas', async () => {
        here.answer('device.importCapture', () => ({ path: '/home/.ruimte/device-captures/placed/phone-2.png', width: 1206, height: 2622 }));
        await openTools();

        await clickOn(button('Place screenshot on canvas'));
        await until(() => useDocument.getState().views.some((view) => view.kind === 'file'));

        expect(here.requests('device.importCapture')).toEqual([{ deviceId: FAKE_SIMULATOR.deviceId, data: btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47)) }]);
        expect(useDocument.getState().views.find((view) => view.kind === 'file')).toMatchObject({ path: '/home/.ruimte/device-captures/placed/phone-2.png' });
    });

    test('points at the capture itself on a machine that cannot keep one', async () => {
        here.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'device.importCapture'));
        await openTools();

        await clickOn(button('Place screenshot on canvas'));
        await until(() => useDocument.getState().views.some((view) => view.kind === 'file'));

        expect(useDocument.getState().views.find((view) => view.kind === 'file')).toMatchObject({
            path: `/home/.ruimte/device-captures/${FAKE_SIMULATOR.deviceId}-1.png`
        });
    });
});
