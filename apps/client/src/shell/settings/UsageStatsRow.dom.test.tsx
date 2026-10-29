import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EndpointInfo } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { adoptEndpointInfo } from '@/transport/server-info';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { everything, installDesktop, removeDesktop } from '../../../testing/dom-helpers';

let page: Mounted;
let release: () => void;
let machine: FakeMachine;
let opened: string[];

function infoOf(usageStats: boolean | undefined): EndpointInfo {
    return {
        id: 'machine-1',
        label: 'Studio',
        platform: 'darwin',
        version: '1.0.0',
        reachability: 'loopback',
        authenticated: false,
        ...(usageStats === undefined ? {} : { usageStats })
    };
}

function usageSwitch(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[aria-label="Send usage statistics from This machine"]');
}

async function open(usageStats: boolean | undefined): Promise<void> {
    machine = new FakeMachine();
    machine.answer('endpoint.setIdentity', (payload) => infoOf(payload.usageStats ?? usageStats));
    release = connectFakeMachine(machine);
    installDesktop({
        openExternal: async (url) => {
            opened.push(url);
        }
    });
    page = mount();
    await page.renderApp();
    await act(async () => adoptEndpointInfo(LOCAL_ENDPOINT_ID, infoOf(usageStats)));
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines', target: 'machines.machine.usageStats' }));
}

beforeEach(() => {
    opened = [];
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false, target: null }));
    await page.unmount();
    release();
    removeDesktop();
});

describe('Settings > Account > this machine > Share anonymous statistics', () => {
    test('is on, links to the privacy page, and turning it off tells the machine', async () => {
        await open(true);
        await until(() => usageSwitch() !== null);
        expect(usageSwitch()?.getAttribute('aria-checked')).toBe('true');

        await clickOn([...document.querySelectorAll('button')].find((element) => element.textContent === 'What is sent') ?? null);
        expect(opened).toEqual(['https://ruimte.app/privacy']);

        await clickOn(usageSwitch());
        await until(() => machine.requests('endpoint.setIdentity').length > 0);
        expect(machine.requests('endpoint.setIdentity')[0]).toMatchObject({ usageStats: false });
    });

    test('is not offered by a machine from before the switch', async () => {
        await open(undefined);
        await until(() => everything().includes('Name and icon'));
        expect(usageSwitch()).toBeNull();
    });
});
