import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EndpointInfo, TextModelChoice } from '@ruimte/contracts';
import { startEndpointWatch } from '@/endpoint/watch';
import { useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { dropMachine, machineFor } from '@/transport/connections';
import { startServerInfo } from '@/transport/server-info';
import { usePickedMachineState } from './picked-machine';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { fakeProvider } from '../../../testing/fake-provider';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';

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

function control(label: string): HTMLButtonElement | null {
    return document.querySelector(`button[aria-label="${label}"]`);
}

async function choose(label: string, option: string): Promise<void> {
    await clickOn(control(label));
    const row = (): Element | undefined => [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.includes(option));
    await until(() => row() !== undefined);
    await clickOn(row()!);
    await until(() => control(label)?.disabled === false);
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
                ]
            }),
            fakeProvider('antigravity', 'Antigravity', {
                models: [{ slug: 'chat-base', name: 'Chat base model', legacy: false, isDefault: true, options: [] }]
            }),
            fakeProvider('nanogpt', 'NanoGPT'),
            fakeProvider('registry-agent', 'Registry-only agent')
        ]
    }));
    there.answer('provider.textModels', () => ({ models: [{ slug: 'print-medium', name: 'Print medium model' }] }));
    there.answer('accounts.list', () => ({
        accounts: {
            codex: { kind: 'codex' },
            'b-work': { kind: 'codex', label: 'Work on B' },
            'agy-work': { kind: 'antigravity', label: 'AGY work' },
            'b-off': { kind: 'codex', label: 'Disabled on B', enabled: false }
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
    await until(() => control('Text model') !== null && useServers.getState().byEndpoint[REMOTE]?.label === 'Build Mac');
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

describe('Settings > Agents > the machine text model', () => {
    test('provider, model and account choices belong to the picked machine, and Automatic removes the explicit choice', async () => {
        await start();
        await until(() => control('Text model')?.disabled === false);
        await clickOn(control('Text model'));
        await until(() => document.querySelector('[role="option"]') !== null);
        const options = [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent).join(' ');
        expect(options).toContain('Codex');
        expect(options).not.toContain('Project Claude');
        expect(options).not.toContain('NanoGPT');
        expect(options).not.toContain('Registry-only');
        await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes('Codex'))!);
        await until(() => control('Model for short texts') !== null);
        await choose('Model for short texts', 'Small on B');
        await choose('Account for short texts', 'Work on B');
        expect(there.requests('endpoint.setIdentity').map((payload) => payload.textModel)).toEqual([
            { provider: 'codex', model: null },
            { provider: 'codex', model: 'small-b' },
            { provider: 'codex', model: 'small-b', account: 'b-work' }
        ]);
        expect(here.requests('endpoint.setIdentity')).toEqual([]);
        await choose('Text model', 'Automatic');
        expect(there.requests('endpoint.setIdentity').at(-1)?.textModel).toBeNull();
        expect(control('Model for short texts')).toBeNull();
    });

    test('a choice from another client updates the controls without a write from this client', async () => {
        await start();
        choice = { provider: 'codex', model: 'large-b', account: 'b-work' };
        await act(async () =>
            there.emit('endpoint.changed', { id: REMOTE, label: 'Build Mac', nameSource: 'default', icon: null, agentsDeleteAnyView: false, textModel: choice })
        );
        await until(() => control('Model for short texts')?.textContent?.includes('Large on B') === true);
        expect(control('Account for short texts')?.textContent).toContain('Work on B');
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('Antigravity offers its print catalog on the picked account and keeps CLI default available after a failed read', async () => {
        await start();
        await until(() => control('Text model')?.disabled === false);
        await choose('Text model', 'Antigravity');
        await until(() => control('Model for short texts')?.disabled === false);
        await clickOn(control('Model for short texts'));
        await until(() => document.querySelector('[role="option"]') !== null);
        const options = [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent).join(' ');
        expect(options).toContain('Print medium model');
        expect(options).not.toContain('Chat base model');
        await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes('Print medium model'))!);
        await until(() => choice?.model === 'print-medium');
        there.answer('provider.textModels', () => {
            throw new Error('Catalog unavailable');
        });
        await choose('Account for short texts', 'AGY work');
        await until(() => document.body.textContent?.includes('Could not load the CLI models') === true);
        expect(there.requests('provider.textModels').at(-1)).toEqual({ provider: 'antigravity', account: 'agy-work' });
        expect(here.requests('provider.textModels')).toEqual([]);
        await choose('Model for short texts', 'CLI default');
        expect(choice).toEqual({ provider: 'antigravity', model: null, account: 'agy-work' });
    });

    test('an older machine with no field explains why the control cannot save', async () => {
        await start('older');
        expect(control('Text model')?.disabled).toBe(true);
        expect(document.body.textContent).toContain('Update this machine to choose a text model.');
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('a disconnected picked machine keeps its choice readable and disables changes', async () => {
        await start({ provider: 'codex', model: 'small-b' });
        await until(() => control('Model for short texts')?.textContent?.includes('Small on B') === true);
        await act(async () => there.drop());
        expect(control('Text model')?.disabled).toBe(true);
        expect(control('Model for short texts')?.textContent).toContain('Small on B');
        expect(there.requests('endpoint.setIdentity')).toEqual([]);
    });

    test('a refused save reports the error and retains the previous choice', async () => {
        await start();
        await until(() => control('Text model')?.disabled === false);
        there.answer('endpoint.setIdentity', () => {
            throw new Error('Save refused');
        });
        await choose('Text model', 'Codex');
        await until(() => document.body.textContent?.includes('Save refused') === true);
        expect(control('Text model')?.textContent).toContain('Automatic');
        expect(control('Model for short texts')).toBeNull();
    });
});
