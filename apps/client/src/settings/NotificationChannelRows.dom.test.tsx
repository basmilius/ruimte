import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ExtensionNotificationChannel } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { everything, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PULSEBOARD: ExtensionNotificationChannel = { extension: 'dev.pulseboard', id: 'log', title: 'Pulseboard', on: false };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let channels: ExtensionNotificationChannel[];

function switchOf(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
}

/* The window as the app on the computer that runs the machine has it, unless the project is on another machine. */
async function open(thisMachine = true): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, { thisMachine });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'notifications' }));
    await until(() => everything().includes('Quiet hours'));
}

beforeEach(() => {
    installDesktop();
    machine = new FakeMachine();
    channels = [PULSEBOARD];
    machine.answer('extension.notificationChannels', () => ({ channels }));
    machine.answer('extension.notificationChannelSet', () => ({}));
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
    removeDesktop();
});

describe('Settings > General > Notifications with a channel of an extension', () => {
    test('lists the channel off, and turning it on tells the machine', async () => {
        await open();
        await until(() => switchOf('Notify through Pulseboard') !== null);
        expect(switchOf('Notify through Pulseboard')?.getAttribute('aria-checked')).toBe('false');
        expect(everything()).toContain('It waits while you are at this computer.');

        await clickOn(switchOf('Notify through Pulseboard'));

        expect(machine.requests('extension.notificationChannelSet')).toEqual([{ extension: 'dev.pulseboard', channel: 'log', on: true }]);
        expect(switchOf('Notify through Pulseboard')?.getAttribute('aria-checked')).toBe('true');
    });

    test('puts the switch back and says why when the machine refuses', async () => {
        machine.answer('extension.notificationChannelSet', () => {
            throw new Error('This machine does not let you');
        });
        await open();
        await until(() => switchOf('Notify through Pulseboard') !== null);
        await clickOn(switchOf('Notify through Pulseboard'));

        await until(() => everything().includes('This machine does not let you'));
        expect(switchOf('Notify through Pulseboard')?.getAttribute('aria-checked')).toBe('false');
    });

    test('follows the extensions of the machine, and shows nothing without a channel', async () => {
        channels = [];
        await open();
        expect(everything()).not.toContain('Notify through');

        channels = [PULSEBOARD];
        await act(async () => machine.emit('extension.changed', {}));
        await until(() => switchOf('Notify through Pulseboard') !== null);
    });

    test('asks nothing of a machine on another computer', async () => {
        await open(false);
        expect(machine.requests('extension.notificationChannels')).toEqual([]);
        expect(everything()).not.toContain('Notify through');
    });
});
