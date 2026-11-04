import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText } from '../../testing/dom-helpers';
import { answerDevices, FAKE_SIMULATOR, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    machine.answer('launches.read', () => ({
        rev: 1,
        launches: [{ id: 'flutter', name: 'Flutter', kind: 'task' as const, command: `flutter run -d ${FAKE_SIMULATOR.deviceId}`, shared: false }],
        approved: []
    }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'launches' }));
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'launches' }));
    await page.unmount();
    workspace.close();
    devices.restore();
});

describe('the device of a launch', () => {
    test('shows the device a flutter run names in a device view of its own, which opens it', async () => {
        await until(() => buttonWithText('Show device') !== null);
        expect(machine.requests('device.open')).toEqual([]);
        await clickOn(buttonWithText('Show device'));
        await until(() => page.host.querySelector(`canvas[aria-label="${FAKE_SIMULATOR.name} screen"]`) !== null);

        expect(machine.requests('device.open')[0]).toMatchObject({ backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId });
    });
});
