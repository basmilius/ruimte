import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { EndpointInfo } from '@ruimte/contracts';
import { act } from 'react';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { adoptEndpointInfo, startServerInfo } from '@/transport/server-info';
import { mount, pressKey, until, type Mounted } from '../../../testing/dom';
import { everything, installDesktop, removeDesktop, typeInto } from '../../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';

let page: Mounted;
let features: string[] = [];
let release: () => void;
let stopInfo: (() => void) | null = null;
let machine: FakeMachine;

function infoOf(startFolder: string | undefined, platform = 'win32'): EndpointInfo {
    return {
        id: 'machine-1',
        label: 'Studio',
        platform,
        version: '1.0.0',
        reachability: 'loopback',
        authenticated: false,
        features,
        ...(startFolder === undefined ? {} : { startFolder })
    };
}

function field(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[aria-label="Start browsing in"]');
}

/* A machine that keeps the start folder it is given, the way the daemon does. */
function startMachine(startFolder: string | undefined, options: { answers?: boolean; watch?: boolean } = {}): void {
    let kept = startFolder;

    features = options.answers === false ? ['endpoint.info', 'endpoint.setIdentity'] : ['endpoint.info', 'endpoint.setStartFolder'];
    machine = new FakeMachine();
    machine.answer('endpoint.info', () => infoOf(kept));
    machine.answer('endpoint.setStartFolder', ({ folder }) => {
        kept = folder.trim();

        return infoOf(kept);
    });

    if (options.answers === false) {
        machine.answersOnly(['endpoint.info', 'endpoint.setIdentity']);
    }

    release = connectFakeMachine(machine);
    stopInfo = options.watch === true ? startServerInfo() : null;
    installDesktop();
}

async function openRow(startFolder: string | undefined): Promise<void> {
    page = mount();
    await page.renderApp();
    useServers.getState().setInfo(LOCAL_ENDPOINT_ID, { platform: 'win32', home: null, version: '1.0.0', model: null });
    await act(async () => adoptEndpointInfo(LOCAL_ENDPOINT_ID, infoOf(startFolder)));
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines', target: 'machines.machine.startFolder' }));
}

beforeEach(() => {
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false, target: null }));
    await page.unmount();
    stopInfo?.();
    stopInfo = null;
    release();
    removeDesktop();
});

describe('Settings > Account > this machine > Start browsing in', () => {
    test('shows what the machine keeps with an example in the style of its paths, and typing a folder sends it', async () => {
        startMachine('D:\\Work');
        await openRow('D:\\Work');
        await until(() => field() !== null);
        expect(field()!.value).toBe('D:\\Work');
        expect(field()!.placeholder).toBe('C:\\Projects');

        await typeInto(field()!, '  E:\\Code ');
        await pressKey(field()!, 'Enter');
        await until(() => machine.requests('endpoint.setStartFolder').length > 0);
        expect(machine.requests('endpoint.setStartFolder')[0]).toEqual({ folder: 'E:\\Code' });
        await until(() => field()!.value === 'E:\\Code');
    });

    test('clearing the field sends an empty folder', async () => {
        startMachine('D:\\Work');
        await openRow('D:\\Work');
        await until(() => field() !== null);

        await typeInto(field()!, '');
        await pressKey(field()!, 'Enter');
        await until(() => machine.requests('endpoint.setStartFolder').length > 0);
        expect(machine.requests('endpoint.setStartFolder')[0]).toEqual({ folder: '' });
    });

    test('is not offered by a machine that does not answer the request', async () => {
        startMachine(undefined, { answers: false });
        await openRow(undefined);
        await until(() => everything().includes('Name and icon'));
        expect(field()).toBeNull();
    });
});

describe('the start folder this client used to keep for every machine', () => {
    beforeEach(() => {
        useSettings.getState().update({ browseStartFolder: '~/old' });
    });

    afterEach(() => {
        useSettings.getState().update({ browseStartFolder: '' });
    });

    test('moves to the local machine once, and the setting is cleared', async () => {
        startMachine('', { watch: true });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('endpoint.setStartFolder').length > 0);
        expect(machine.requests('endpoint.setStartFolder')).toEqual([{ folder: '~/old' }]);
        await until(() => useSettings.getState().browseStartFolder === '');
    });

    test('is dropped, not sent, when the machine already has a start folder', async () => {
        startMachine('D:\\Work', { watch: true });
        page = mount();
        await page.renderApp();
        await until(() => useSettings.getState().browseStartFolder === '');
        expect(machine.requests('endpoint.setStartFolder')).toEqual([]);
    });

    test('stays set on a machine that cannot take it yet', async () => {
        startMachine('', { answers: false, watch: true });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('endpoint.info').length > 0);
        expect(machine.requests('endpoint.setStartFolder')).toEqual([]);
        expect(useSettings.getState().browseStartFolder).toBe('~/old');
    });
});
