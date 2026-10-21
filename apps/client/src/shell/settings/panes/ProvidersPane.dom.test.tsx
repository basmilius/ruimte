import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentServerStatus, ProviderInfo } from '@ruimte/contracts';
import { currentEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

const ANTIGRAVITY: ProviderInfo = {
    kind: 'antigravity',
    name: 'Antigravity',
    installed: false,
    version: null,
    models: [],
    defaultModel: null,
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'none',
        attachments: false,
        mentions: false,
        denyReason: false,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: false
    },
    resumeCommand: 'agy {flags} --conversation {id}',
    install: {
        description: "Google's coding agent, in a terminal and in a chat.",
        commands: { darwin: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
        signIn: [{ kind: 'chat' }]
    }
};

const CHAT_ONLY: ProviderInfo['capabilities'] = { ...ANTIGRAVITY.capabilities, terminal: false, hooks: false };

const NANOGPT: ProviderInfo = {
    kind: 'nanogpt',
    name: 'NanoGPT',
    installed: false,
    version: null,
    models: [],
    defaultModel: null,
    capabilities: CHAT_ONLY,
    resumeCommand: ''
};

const APPLE: ProviderInfo = { ...NANOGPT, kind: 'apple', name: 'Apple Foundation Models', version: 'Disabled in Settings' };

const SERVER_MISSING: AgentServerStatus = { provider: 'antigravity', state: 'missing', version: '1.4.1', installed: null };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function stepStates(): Record<string, string | undefined> {
    const steps = [...document.querySelectorAll<HTMLElement>('[role="dialog"] li[data-state]')];
    return Object.fromEntries(steps.map((step) => [step.querySelector('h4')?.textContent ?? '', step.dataset.state]));
}

async function openProviders(providers: ProviderInfo[]): Promise<void> {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers }));
    machine.answer('provider.server', () => ({ server: SERVER_MISSING }));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'providers' }));
}

async function openInstallPage(): Promise<void> {
    await openProviders([ANTIGRAVITY]);
    const row = (): HTMLButtonElement | undefined =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent?.includes('Antigravity'));
    await until(() => row() !== undefined);
    await clickOn(row()!);
    await until(() => stepStates()['Install the CLI'] !== undefined);
}

afterEach(async () => {
    // The stores outlive the page, and the next file would open on these settings.
    useUi.getState().setSettings({ open: false, section: 'appearance', target: null });
    useServers.setState({ byEndpoint: {} });
    await page.unmount();
    workspace.close();
});

describe('installing Antigravity in Settings, Providers', () => {
    test('the CLI is done once `agy` is found, and the chat server is the step after it', async () => {
        await openInstallPage();
        expect(stepStates()).toMatchObject({ 'Install the CLI': 'current', 'Install the chat server': 'later' });

        // What the machine reports once `agy` is there and its chat server is not yet.
        act(() =>
            machine.emit('provider.changed', {
                providers: [{ ...ANTIGRAVITY, installed: true, version: '1.4.0', capabilities: { ...ANTIGRAVITY.capabilities, chat: false } }]
            })
        );
        await until(() => stepStates()['Install the CLI'] === 'done');
        expect(stepStates()['Install the chat server']).toBe('current');
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Installed, version 1.4.0.');
    });
});

describe('the providers list in Settings, Providers', () => {
    test('NanoGPT without a key and Apple turned off need setup, and say why', async () => {
        await openProviders([NANOGPT, APPLE]);
        const endpointId = currentEndpointId();
        await act(async () =>
            useServers.setState(({ byEndpoint }) => ({
                byEndpoint: { ...byEndpoint, [endpointId]: { ...byEndpoint[endpointId]!, platform: 'darwin', appleFoundationEnabled: false } }
            }))
        );
        const group = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"] section[aria-label="Needs setup"]');
        await until(() => group()?.textContent?.includes('Apple Foundation Models') === true);
        expect(group()?.textContent).toContain('NanoGPTNo key');
        expect(group()?.textContent).toContain('Apple Foundation ModelsOff');
        expect(document.querySelector('[role="dialog"] section[aria-label="Ready"]')).toBeNull();
    });
});
