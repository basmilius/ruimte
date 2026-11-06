import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { DesktopBridge } from '@/desktop/bridge';
import { useUi } from '@/state/ui';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { machineBridge } from '../../testing/machine-bridge';

let page: Mounted;
let release: (() => void) | null;
let chosen: string[];
let choose: (mode: 'local' | 'none') => Promise<void>;

function text(): string {
    return page.host.textContent ?? document.body.textContent ?? '';
}

function row(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="tab"], [role="option"], button')].find((element) => element.textContent?.includes(label)) ?? null;
}

async function open(machine: DesktopBridge['machine']): Promise<void> {
    installDesktop({ machine });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
}

/* Confirms the restart to run a machine on a shell that refuses it with `failure`. */
async function setUpRefused(failure: Error): Promise<void> {
    choose = () => Promise.reject(failure);
    await open(machineBridge('none', { choose: (mode) => choose(mode) }));
    await until(() => row('This computer') !== null);
    await clickOn(row('This computer'));
    await until(() => buttonWithText('Set up') !== null);
    await clickOn(buttonWithText('Set up'));
    await clickOn(buttonWithText('Restart'));
}

beforeEach(() => {
    release = null;
    chosen = [];
    choose = async (mode) => {
        chosen.push(mode);
    };
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release?.();
    removeDesktop();
});

describe('Settings > Machines of an app that runs no machine', () => {
    test('lists this computer, and its detail offers to run a machine, restarting only after a confirm', async () => {
        await open(machineBridge('none', { choose: (mode) => choose(mode) }));
        await until(() => row('Only connects to your machines') !== null);
        await clickOn(row('This computer'));
        await until(() => everything().includes('Run a machine on this computer'));
        await clickOn(buttonWithText('Set up'));
        await until(() => everything().includes('Restart Ruimte to run a machine here?'));
        expect(chosen).toEqual([]);
        await clickOn(buttonWithText('Restart'));
        expect(chosen).toEqual(['local']);
    });

    test('a choice that could not be saved stays in the dialog with its reason', async () => {
        await setUpRefused(new Error('disk full'));
        await until(() => everything().includes('disk full'));
        expect(everything()).toContain('Restart Ruimte to run a machine here?');
    });

    test('a failure of the shell itself is told in our own words', async () => {
        await setUpRefused(new Error("Error invoking remote method 'machine:choose': Error: EACCES"));
        await until(() => everything().includes('Ruimte could not restart to run a machine here. Try again.'));
        expect(everything()).not.toContain('Error invoking');
    });

    test('an app that runs a machine has no row for this computer', async () => {
        // The detail of this machine connects to it, so a fake stands behind the pool instead of a socket.
        release = connectFakeMachine(new FakeMachine());
        await open(undefined);
        await until(() => everything().includes('This machine'));
        expect(row('Only connects to your machines')).toBeNull();
        expect(text()).not.toContain('Run a machine on this computer');
    });
});
