import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Account, Machine } from '@ruimte/pulsar';
import { act } from 'react';
import type { DesktopBridge } from '@/desktop/bridge';
import { appCommands } from '@/palette/app-commands';
import { usePulsarAccount } from '@/pulsar/account';
import { searchSettings } from '@/settings/search';
import { menuContext } from '@/shell/menu/context';
import { menuModel } from '@/shell/menu/model';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { useUi } from '@/state/ui';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { removeDesktop } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { machineBridge } from '../../testing/machine-bridge';

const STUDIO: Machine = { id: 'studio', name: 'Studio', icon: null, publicKey: 'A'.repeat(43), brokerUrl: 'wss://broker.ruimte.app', lastSeenAt: null };
const ATTIC: Machine = { id: 'attic', name: 'Attic', icon: null, publicKey: 'B'.repeat(43), brokerUrl: 'wss://broker.ruimte.app', lastSeenAt: null };

/* The shell of an app that was told to run no machine: no secret, no service, only the mode. */
const bridge: DesktopBridge = {
    platform: 'darwin',
    pickFolder: async () => null,
    openExternal: async () => undefined,
    openGuestDevTools: () => undefined,
    requestKeepAwake: () => undefined,
    machine: machineBridge('none')
};

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let page: Mounted;

function text(): string {
    return page.host.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.includes(label)) ?? null;
}

function signIn(machines: Machine[]): void {
    usePulsarAccount.setState({ status: 'signed-in', account: { id: 'account', provider: 'github', login: 'bas' } as unknown as Account });
    usePulsarMachines.setState({ machines });
}

beforeEach(async () => {
    scope.window.ruimteDesktop = bridge;
    useWindow.getState().setBooting(false);
    usePulsarAccount.setState({ status: 'signed-out', account: null });
    usePulsarMachines.setState({ machines: null });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    usePulsarAccount.setState({ status: 'loading', account: null });
    usePulsarMachines.setState({ machines: null });
    useUi.setState({ paletteOpen: false, paletteBrowseFor: 'folder' });
    removeDesktop();
});

describe('the start screen of an app that runs no machine', () => {
    test('signed out it leads with signing in, says it is about this app, and opens no folder', () => {
        expect(text()).toContain('Sign in to open your machines from this app.');
        expect(text()).not.toContain('This machine');
    });

    test('the same window with a machine of its own does not wait for the account', async () => {
        const waiting = button('Open folder')?.disabled;
        await page.unmount();
        scope.window.ruimteDesktop = { ...bridge, machine: machineBridge('local') };
        // A machine behind the pool, so the local row never opens a socket of its own.
        const release = connectFakeMachine(new FakeMachine());
        try {
            page = mount();
            await page.renderApp();
            await until(() => button('Open folder') !== null);
            expect(waiting).toBe(true);
            expect(button('Open folder')?.disabled).toBe(false);
            expect(text()).not.toContain('from this app');
        } finally {
            release();
        }
    });

    test('signed in it lists the machines of the account and no row for this computer', async () => {
        await act(async () => signIn([STUDIO, ATTIC]));
        await until(() => text().includes('Studio'));
        expect(text()).toContain('Attic');
        expect(text()).not.toContain('This machine');
    });

    test('a new chat asks which machine, as it does on the station', async () => {
        await act(async () => signIn([STUDIO, ATTIC]));
        await until(() => text().includes('Studio'));
        await clickOn(button('New chat'));
        expect(useUi.getState().paletteBrowseFor).toBe('chat');
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('keep awake is found nowhere, and neither is the setup in the Help menu', () => {
        expect(searchSettings('keep awake')).toEqual([]);
        expect(searchSettings('keep running')).toEqual([]);
        expect(appCommands().some((command) => command.id.startsWith('keep-awake'))).toBe(false);
        const help = menuModel(menuContext('desktop')).menus.find((menu) => menu.label === 'Help');
        expect(JSON.stringify(help)).not.toContain('onboarding');
    });
});
