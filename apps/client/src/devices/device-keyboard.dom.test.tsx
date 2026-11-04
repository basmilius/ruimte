import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { answerDevices, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };
const COMMAND = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreClipboard: () => void;

function screen(): HTMLCanvasElement | null {
    return page.host.querySelector<HTMLCanvasElement>(`canvas[aria-label="${FAKE_SIMULATOR.name} screen"]`);
}

async function key(type: 'keydown' | 'keyup', code: string, keyName: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> {
    await act(async () => {
        screen()!.dispatchEvent(new KeyboardEvent(type, { key: keyName, code, bubbles: true, cancelable: true, ...modifiers }));
    });
}

function keyInputs(): unknown[] {
    return machine
        .requests('device.input')
        .map((request) => request.input)
        .filter((input) => input.kind === 'key');
}

beforeEach(async () => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    const readText = spyOn(navigator.clipboard, 'readText').mockImplementation(async () => 'héllo 👋');
    restoreClipboard = () => readText.mockRestore();
    workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => screen() !== null);
    await act(async () => screen()!.focus());
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
    restoreClipboard();
});

describe("a person's keyboard on a device", () => {
    test('sends the keys pressed on the focused screen and pastes the paste chord through the clipboard', async () => {
        await key('keydown', 'KeyA', 'a');
        await key('keyup', 'KeyA', 'a');
        await key('keydown', 'Enter', 'Enter');
        await key('keyup', 'Enter', 'Enter');
        await key('keydown', 'KeyV', 'v', COMMAND);
        await until(() => machine.requests('device.clipboard').length === 1);

        expect(keyInputs()).toEqual([
            { kind: 'key', phase: 'down', usage: 0x04 },
            { kind: 'key', phase: 'up', usage: 0x04 },
            { kind: 'key', phase: 'down', usage: 0x28 },
            { kind: 'key', phase: 'up', usage: 0x28 }
        ]);
        expect(machine.requests('device.clipboard')).toEqual([
            { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId, text: 'héllo 👋', paste: true }
        ]);
    });

    test("leaves Ruimte's own shortcuts working with the focus on the screen", async () => {
        await key('keydown', 'KeyK', 'k', COMMAND);
        await until(() => document.querySelector('[role="dialog"]') !== null);

        expect(keyInputs()).toEqual([]);
        await pressKey(document.activeElement!, 'Escape');
        await until(() => document.querySelector('[role="dialog"]') === null);
    });

    test('lets go of the keys still held when the screen loses the focus', async () => {
        await key('keydown', 'ShiftLeft', 'Shift');
        await act(async () => screen()!.blur());

        expect(keyInputs()).toEqual([
            { kind: 'key', phase: 'down', usage: 0xe1 },
            { kind: 'key', phase: 'up', usage: 0xe1 }
        ]);
    });
});
