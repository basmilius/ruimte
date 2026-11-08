import { afterEach, describe, expect, test } from 'bun:test';
import type { EndpointInfo, TextModelChoice } from '@ruimte/contracts';
import { act } from 'react';
import { startEndpointWatch } from '@/endpoint/watch';
import { useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { dropMachine, machineFor } from '@/transport/connections';
import { startServerInfo } from '@/transport/server-info';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { fakeProvider } from '../../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { usePickedMachineState } from './picked-machine';

const REMOTE = 'text-settings-b';
let workspace: FakeWorkspace;
let page: Mounted;
let here: FakeMachine;
let there: FakeMachine;
let choice: TextModelChoice | null | undefined;
let stops: (() => void)[];

function info(id: string): EndpointInfo {
    return {
        id,
        label: id === REMOTE ? 'Build Mac' : 'Project Mac',
        platform: 'darwin',
        version: '1',
        reachability: 'lan',
        authenticated: true,
        ...(choice === undefined ? {} : { textModel: id === REMOTE ? choice : null })
    };
}

function mode(label: string): HTMLElement | null {
    const group = document.querySelector('[role="radiogroup"][aria-label="Text model"]');

    return ([...(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])] as HTMLElement[]).find((radio) => radio.textContent === label) ?? null;
}

/* The picker beside the Automatic and Choose buttons, found by what it shows. */
function pickerChip(name: string): HTMLButtonElement | null {
    const row = document.querySelector('[role="radiogroup"][aria-label="Text model"]')?.parentElement;
    const buttons = [...(row?.querySelectorAll('button:not([role="radio"])') ?? [])] as HTMLButtonElement[];

    return buttons.find((button) => button.textContent?.includes(name) === true) ?? null;
}

async function start(initial: TextModelChoice | null | 'older' = null): Promise<void> {
    choice = initial === 'older' ? undefined : initial;
    usePickedMachineState.setState({ id: null });
    here = new FakeMachine();
    there = new FakeMachine();
    here.answer('endpoint.info', () => info('fake-machine'));
    there.answer('endpoint.info', () => info(REMOTE));
    here.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Project Claude')] }));
    there.answer('provider.list', () => ({
        providers: [
            fakeProvider('codex', 'Codex', {
                models: [
                    { slug: 'small-b', name: 'Small on B', legacy: false, isDefault: true, options: [] },
                    { slug: 'large-b', name: 'Large on B', legacy: false, isDefault: false, options: [] }
                ],
                defaultModel: 'small-b'
            }),
            fakeProvider('nanogpt', 'NanoGPT'),
            fakeProvider('registry-agent', 'Registry-only agent')
        ]
    }));
    there.answer('accounts.list', () => ({
        accounts: {
            codex: { kind: 'codex' },
            'b-work': { kind: 'codex', label: 'Work on B' }
        },
        statuses: []
    }));
    there.answer('endpoint.setIdentity', (payload) => {
        if (payload.textModel !== undefined) {
            choice = payload.textModel;
        }

        return info(REMOTE);
    });
    stops = [startServerInfo(), startEndpointWatch()];
    workspace = await openFakeWorkspace(here, { views: [] }, { activeViewId: null, views: {} });
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'Build Mac',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    stops.push(connectFakeMachine(there, REMOTE));
    // Another surface already has this machine's connection and machine-scoped stores.
    machineFor(REMOTE);
    page = mount();
    await page.renderApp();
    await act(async () => {
        usePickedMachineState.getState().pick(REMOTE);
        useUi.getState().setSettings({ open: true, section: 'agents' });
    });
    await until(() => mode('Automatic') !== null && useServers.getState().byEndpoint[REMOTE]?.label === 'Build Mac');
}

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    stops.forEach((stop) => stop());
    dropMachine(REMOTE);
    useEndpoints.getState().remove(REMOTE);
    workspace.close();
    useServers.getState().forget(REMOTE);
    useServers.getState().forget('fake-machine');
    usePickedMachineState.setState({ id: null });
});

describe('Settings > Agents > Text model', () => {
    test('saves the choice on the picked machine, offers its CLIs only and Automatic removes the choice', async () => {
        await start();
        await until(() => mode('Choose')?.hasAttribute('disabled') === false);
        await clickOn(mode('Choose'));
        await until(() => choice !== null);

        expect(choice).toEqual({ provider: 'codex', model: null });
        expect(here.requests('endpoint.setIdentity')).toEqual([]);

        // The picker follows the picked machine: its Codex, with the cheapest model it lists, and not the project's Claude.
        await until(() => pickerChip('Small on B') !== null);
        expect(pickerChip('Project Claude')).toBeNull();
        await clickOn(pickerChip('Small on B'));
        await until(() => document.querySelector('[role="option"]') !== null);

        const options = [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent).join(' ');

        expect(options).toContain('Large on B');
        expect(options).not.toContain('NanoGPT');

        await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes('Large on B'))!);
        await until(() => choice?.model === 'large-b');
        expect(there.requests('endpoint.setIdentity').map((payload) => payload.textModel)).toEqual([
            { provider: 'codex', model: null },
            { provider: 'codex', model: 'large-b' }
        ]);

        await clickOn(mode('Automatic'));
        await until(() => choice === null);
        expect(there.requests('endpoint.setIdentity').at(-1)?.textModel).toBeNull();
        expect(mode('Automatic')?.getAttribute('aria-checked')).toBe('true');
    });

    test('a choice made on another client shows without a write from this one', async () => {
        await start();
        choice = { provider: 'codex', model: 'large-b', account: 'b-work' };
        await act(async () =>
            there.emit('endpoint.changed', { id: REMOTE, label: 'Build Mac', nameSource: 'default', icon: null, agentsDeleteAnyView: false, textModel: choice })
        );
        await until(() => mode('Choose')?.getAttribute('aria-checked') === 'true');
        await until(() => pickerChip('Large on B') !== null);
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('an older machine with no field explains why the choice cannot be saved', async () => {
        await start('older');

        expect(mode('Choose')?.hasAttribute('disabled')).toBe(true);
        expect(document.body.textContent).toContain('Update this machine to choose a text model.');
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('a choice whose CLI is gone says so instead of showing another CLI', async () => {
        await start({ provider: 'grok', model: null });
        await until(() => document.body.textContent?.includes('is not available on this machine') === true);

        expect(pickerChip('Codex')).toBeNull();
        expect(mode('Choose')?.getAttribute('aria-checked')).toBe('true');
    });

    test('a disconnected machine keeps its choice readable and cannot change it', async () => {
        await start({ provider: 'codex', model: 'small-b' });
        await until(() => pickerChip('Small on B') !== null);
        await act(async () => there.drop());

        expect(mode('Automatic')?.hasAttribute('disabled')).toBe(true);
        expect(mode('Choose')?.getAttribute('aria-checked')).toBe('true');
        expect(document.body.textContent).toContain('Codex · Small on B');
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('a refused save reports the error and keeps the previous choice', async () => {
        await start();
        await until(() => mode('Choose')?.hasAttribute('disabled') === false);
        there.answer('endpoint.setIdentity', () => {
            throw new Error('Save refused');
        });
        await clickOn(mode('Choose'));
        await until(() => document.body.textContent?.includes('Save refused') === true);

        expect(mode('Automatic')?.getAttribute('aria-checked')).toBe('true');
        expect(pickerChip('Small on B')).toBeNull();
    });
});
