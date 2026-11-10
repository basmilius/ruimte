import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS, type RequestType } from '@ruimte/contracts';
import { swapPeerLinker } from '@/clients/project/peer-linker';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { button, phoneCanvas } from '../../testing/device-dom';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_SIMULATOR, type FakeDevices } from '../../testing/fake-devices';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const REMOTE = 'machine-b';
const MAIN = phoneCanvas(REMOTE);

let here: FakeMachine;
let there: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let restoreLinker: () => void;

beforeEach(async () => {
    restoreLinker = swapPeerLinker(async () => undefined);
    here = new FakeMachine();
    there = new FakeMachine();
    devices = answerDevices(there);
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'Mac Studio',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => button('Device tools') !== null);
    await clickOn(button('Device tools'));
    await until(() => button('Place screenshot on canvas') !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
    disconnectThere();
    restoreLinker();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a screenshot of a device on another machine', () => {
    test('is kept on the machine of the project before a view of it goes on the canvas', async () => {
        here.answer('device.importCapture', () => ({ path: '/home-a/.ruimte/device-captures/phone-2.png', width: 1206, height: 2622 }));

        await clickOn(button('Place screenshot on canvas'));
        await until(() => useDocument.getState().views.some((view) => view.kind === 'file'));

        expect(there.requests('device.capture')).toHaveLength(1);
        expect(devices.read).toEqual([`/home/.ruimte/device-captures/${FAKE_SIMULATOR.deviceId}-1.png`]);
        expect(here.requests('device.importCapture')).toEqual([{ deviceId: FAKE_SIMULATOR.deviceId, data: btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47)) }]);
        expect(useDocument.getState().views.find((view) => view.kind === 'file')).toMatchObject({ path: '/home-a/.ruimte/device-captures/phone-2.png' });
    });

    test('is refused with a reason when the machine of the project cannot keep it', async () => {
        here.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'device.importCapture'));

        await clickOn(button('Place screenshot on canvas'));
        await until(() => document.body.textContent?.includes('cannot keep a screenshot from another machine') === true);

        expect(here.requests('device.importCapture')).toEqual([]);
        expect(useDocument.getState().views.some((view) => view.kind === 'file')).toBe(false);
    });
});
