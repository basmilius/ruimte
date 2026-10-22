import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { answerDevices, FAKE_EMULATOR, FAKE_SIMULATOR, referenceOf, type FakeDevices } from '../../testing/fake-devices';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const PHONE: ProjectView = { kind: 'device', id: 'phone', name: FAKE_SIMULATOR.name, device: referenceOf(FAKE_SIMULATOR) };
const PIXEL: ProjectView = { kind: 'device', id: 'pixel', name: FAKE_EMULATOR.name, device: referenceOf(FAKE_EMULATOR) };

let machine: FakeMachine;
let devices: FakeDevices;
let workspace: FakeWorkspace;
let page: Mounted;
let downloads: string[];
let clipboardWrites: unknown[];
let restores: Array<() => void>;

function button(label: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

function buttonWithText(text: string): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

/* The window's connection light is a status too, so the badge is found by its label. */
function recordingBadge(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('[role="status"][aria-label^="Recording, "]');
}

async function openTools(view: ProjectView): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [view] }, { activeViewId: view.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => button('Device tools') !== null);
    await clickOn(button('Device tools'));
    await until(() => button('Copy screenshot') !== null);
}

beforeEach(() => {
    machine = new FakeMachine();
    devices = answerDevices(machine);
    downloads = [];
    clipboardWrites = [];
    const click = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
    });
    const hadClipboardItem = 'ClipboardItem' in globalThis;
    if (!hadClipboardItem) {
        (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
            readonly items: Record<string, unknown>;
            constructor(items: Record<string, unknown>) {
                this.items = items;
            }
        };
    }
    const write = spyOn(navigator.clipboard, 'write').mockImplementation(async (items) => {
        clipboardWrites.push(...items);
    });
    restores = [
        () => click.mockRestore(),
        () => write.mockRestore(),
        () => {
            if (!hadClipboardItem) {
                delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
            }
        }
    ];
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    devices.restore();
    for (const restore of restores) {
        restore();
    }
});

describe('the clipboard of a device', () => {
    test("sends the person's clipboard to the device and copies the device's back", async () => {
        const readText = spyOn(navigator.clipboard, 'readText').mockImplementation(async () => 'from my laptop ✓');
        const written: string[] = [];
        const writeText = spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
            written.push(text);
        });
        restores.push(
            () => readText.mockRestore(),
            () => writeText.mockRestore()
        );
        await openTools(PIXEL);

        await clickOn(buttonWithText('Send my clipboard'));
        await until(() => devices.clipboard === 'from my laptop ✓');
        devices.clipboard = 'copied on the phone';
        await clickOn(buttonWithText('Copy device clipboard'));
        await until(() => written.length === 1);

        expect(machine.requests('device.clipboard')).toEqual([
            { backendId: 'android', platform: 'android', deviceId: FAKE_EMULATOR.deviceId, text: 'from my laptop ✓' },
            { backendId: 'android', platform: 'android', deviceId: FAKE_EMULATOR.deviceId }
        ]);
        expect(written).toEqual(['copied on the phone']);
    });
});

describe('the status bar, biometrics and permissions of a device', () => {
    test('sends a clean status bar, a Face ID match and every permission at once', async () => {
        await openTools(PHONE);
        await until(() => buttonWithText('Clean') !== null);

        await clickOn(buttonWithText('Clean'));
        await until(() => machine.requests('device.action').length === 1);
        const faceRow = [...document.body.querySelectorAll<HTMLElement>('div')].find(
            (row) => row.firstElementChild?.textContent === 'Face ID' && row.querySelector('button') !== null
        );
        await clickOn([...faceRow!.querySelectorAll<HTMLElement>('button')].find((button) => button.textContent?.trim() === 'Match') ?? null);
        await until(() => machine.requests('device.action').length === 2);
        const permissions = [...document.body.querySelectorAll('section')].find((section) => section.querySelector('h3')?.textContent === 'Permissions')!;
        const appField = permissions.querySelector<HTMLInputElement>('input')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(appField, 'com.example.app');
            appField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickOn(buttonWithText('Grant all'));
        await until(() => machine.requests('device.action').length === 3);

        expect(machine.requests('device.action').map(({ backendId: _backend, platform: _platform, deviceId: _device, ...action }) => action)).toEqual([
            { action: 'setStatusBar', value: 'clean' },
            { action: 'biometric', sensor: 'face', event: 'match' },
            { action: 'setAllPermissions', appId: 'com.example.app', decision: 'grant' }
        ]);
    });
});

describe('installing on a device', () => {
    test('installs an app picked from the files of the machine', async () => {
        const entry = (name: string, kind: 'file' | 'directory') => ({
            name,
            path: `/work/atlas/${name}`,
            kind,
            size: null,
            mtime: 1,
            hidden: false,
            ignored: false
        });
        machine.answer('fs.list', ({ path }) => ({
            path,
            entries: [entry('build', 'directory'), entry('Atlas.app', 'directory'), entry('notes.txt', 'file')],
            truncated: false
        }));
        await openTools(PHONE);

        await clickOn(buttonWithText('Install app…'));
        await until(() => buttonWithText('Atlas.app') !== null);
        expect(buttonWithText('notes.txt')).toBeNull();
        await clickOn(buttonWithText('Atlas.app'));
        await until(() => machine.requests('device.action').length === 1);

        expect(machine.requests('fs.list')[0]).toEqual({ path: '/work/atlas' });
        expect(machine.requests('device.action')[0]).toEqual({
            backendId: 'simctl',
            platform: 'ios',
            deviceId: FAKE_SIMULATOR.deviceId,
            action: 'installApp',
            path: '/work/atlas/Atlas.app'
        });
    });
});

describe('the camera of a simulator', () => {
    test('shows a test pattern to the app named, then a picture picked from the files of the machine', async () => {
        machine.answer('fs.list', ({ path }) => ({
            path,
            entries: ['qr.png', 'notes.txt'].map((name) => ({
                name,
                path: `/work/atlas/${name}`,
                kind: 'file' as const,
                size: 1,
                mtime: 1,
                hidden: false,
                ignored: false
            })),
            truncated: false
        }));
        await openTools(PHONE);
        const camera = [...document.body.querySelectorAll('section')].find((section) => section.querySelector('h3')?.textContent === 'Camera')!;
        expect(camera.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
        const appField = camera.querySelector<HTMLInputElement>('input')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(appField, 'com.example.scan');
            appField.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await clickOn(buttonWithText('Test pattern'));
        await until(() => machine.requests('device.action').length === 1);
        await clickOn(buttonWithText('File'));
        await until(() => buttonWithText('qr.png') !== null);
        expect(buttonWithText('notes.txt')).toBeNull();
        await clickOn(buttonWithText('qr.png'));
        await until(() => machine.requests('device.action').length === 2);

        expect(machine.requests('device.action').map(({ backendId: _backend, platform: _platform, deviceId: _device, ...action }) => action)).toEqual([
            { action: 'setCamera', appId: 'com.example.scan', source: 'placeholder' },
            { action: 'setCamera', appId: 'com.example.scan', source: 'file', path: '/work/atlas/qr.png' }
        ]);
    });
});

describe('capturing a device', () => {
    test('copies and saves a screenshot the machine took for the person', async () => {
        await openTools(PHONE);

        await clickOn(button('Copy screenshot'));
        await until(() => clipboardWrites.length === 1);
        await clickOn(button('Save screenshot'));
        await until(() => downloads.length === 1);

        expect(machine.requests('device.capture')).toEqual([
            { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId },
            { backendId: 'simctl', platform: 'ios', deviceId: FAKE_SIMULATOR.deviceId }
        ]);
        expect(downloads[0]).toMatch(/^iPhone 18 Pro \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/);
        expect(devices.read).toContain(`/home/.ruimte/device-captures/${FAKE_SIMULATOR.deviceId}-1.png`);
    });

    test('records the screen, shows it runs over the screen and downloads the video when it stops there', async () => {
        await openTools(PIXEL);

        expect(document.body.textContent).toContain('Android stops recordings after 3 minutes.');
        await clickOn(buttonWithText('Record'));
        await until(() => button('Stop recording') !== null);
        expect(recordingBadge()).not.toBeNull();

        await clickOn(recordingBadge()?.querySelector('button') ?? null);
        await until(() => downloads.length === 1);

        expect(machine.requests('device.record').map((request) => request.mode)).toEqual(['start', 'stop']);
        expect(downloads[0]).toMatch(/^Pixel 9 .*\.mp4$/);
        expect(recordingBadge()).toBeNull();
    });

    test('a recording that ended by itself before a reload shows as ended, offers no new one and saves its video', async () => {
        devices.recording = true;
        devices.settings = { recordingEnded: true };
        await openTools(PIXEL);
        await until(() => buttonWithText('Save video') !== null);

        expect(buttonWithText('Record')).toBeNull();
        expect(page.host.querySelector('[role="status"][aria-label="Recording ended; video ready"]')).not.toBeNull();
        await clickOn(buttonWithText('Save video'));
        await until(() => downloads.length === 1);

        expect(machine.requests('device.record').map((request) => request.mode)).toEqual(['stop']);
        expect(downloads[0]).toMatch(/^Pixel 9 .*\.mp4$/);
        expect(page.host.querySelector('[role="status"][aria-label="Recording ended; video ready"]')).toBeNull();
        expect(buttonWithText('Record')).not.toBeNull();
    });

    test('leaves capture out on a machine that does not answer it', async () => {
        machine.answersOnly(['device.list', 'device.open', 'device.detail', 'device.action', 'device.input']);
        workspace = await openFakeWorkspace(machine, { views: [PHONE] }, { activeViewId: PHONE.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => button('Device tools') !== null);
        await clickOn(button('Device tools'));
        await until(() => document.body.textContent?.includes('Permissions') === true);

        expect(button('Copy screenshot')).toBeNull();
    });
});
