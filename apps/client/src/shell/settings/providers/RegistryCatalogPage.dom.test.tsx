import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CliVersion, ProviderInfo, RegistryAgent, RegistryCatalog } from '@ruimte/contracts';
import { CliVersionSection } from '@/shell/settings/providers/CliVersionSection';
import { RegistryCatalogPage } from '@/shell/settings/providers/RegistryCatalogPage';
import { useCliVersions, useRegistryCatalog } from '@/shell/settings/providers/use-provider-installs';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { FakeMachine, connectFakeMachine } from '../../../../testing/fake-machine';
import { act } from 'react';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

const GOOSE: RegistryAgent = {
    id: 'goose',
    kind: 'goose',
    name: 'goose',
    version: '1.55.0',
    description: 'A local, extensible agent',
    distribution: 'binary',
    checksum: true,
    installed: null,
    state: 'missing'
};

const KILO: RegistryAgent = {
    id: 'kilo',
    kind: 'kilo',
    name: 'Kilo',
    version: '7.8.15',
    description: 'The open source coding agent',
    distribution: 'npm',
    checksum: false,
    installed: null,
    state: 'missing'
};

const LIVE: RegistryCatalog = { source: 'live', fetchedAt: 1, platform: 'darwin-aarch64', agents: [GOOSE, KILO] };

let machine: FakeMachine;
let release: () => void;
let page: Mounted;
let opened: string[];

function Catalog() {
    const registry = useRegistryCatalog(LOCAL_ENDPOINT_ID);
    return <RegistryCatalogPage registry={registry} onOpen={(kind) => opened.push(kind)} />;
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
        input.focus();
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function text(): string {
    return document.body.textContent ?? '';
}

beforeEach(() => {
    opened = [];
    machine = new FakeMachine();
    machine.answer('provider.registry', () => ({ catalog: LIVE }));
    machine.answer('provider.installAgent', ({ id }) => ({
        agent: { ...(id === 'goose' ? GOOSE : KILO), installed: GOOSE.version, state: 'installed' as const }
    }));
    machine.answer('provider.list', () => ({ providers: [] }));
    release = connectFakeMachine(machine);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    release();
});

describe('adding a provider from the ACP registry', () => {
    test('shows the whole catalog without a search, and narrows it as a person types', async () => {
        await page.render(<Catalog />);
        await until(() => text().includes('Kilo'));
        expect(text()).toContain('goose');
        expect(text()).toContain('Version 1.55.0 · verified');
        expect(text()).toContain('Version 7.8.15');
        expect(text()).not.toContain('npm package');

        await typeInto(document.querySelector('input')!, 'open source');
        await until(() => !text().includes('A local, extensible agent'));
        expect(text()).toContain('Kilo');

        await typeInto(document.querySelector('input')!, 'nothing like it');
        await until(() => text().includes('No agent matches "nothing like it".'));
    });

    test('installs an agent on a press, asks for the providers again and opens it', async () => {
        await page.render(<Catalog />);
        await until(() => button('Install') !== null);
        const listsBefore = machine.requests('provider.list').length;
        await clickOn(button('Install'));
        await until(() => button('Open') !== null);
        expect(machine.requests('provider.installAgent')).toEqual([{ id: 'goose' }]);
        expect(machine.requests('provider.list').length).toBeGreaterThan(listsBefore);
        await clickOn(button('Open'));
        expect(opened).toEqual(['goose']);
    });

    test('shows the last good catalog when the registry cannot be reached, and says why', async () => {
        machine.answer('provider.registry', () => ({ catalog: { ...LIVE, source: 'cached' as const, error: 'The list of agents is unavailable (503)' } }));
        await page.render(<Catalog />);
        await until(() => text().includes('Could not refresh the list (The list of agents is unavailable (503)).'));
        expect(text()).toContain('Kilo');
    });

    test('says what went wrong when there is no catalog at all, and tries again on a press', async () => {
        machine.answer('provider.registry', () => ({
            catalog: { source: 'unavailable' as const, fetchedAt: null, error: 'offline', platform: 'darwin-aarch64', agents: [] }
        }));
        await page.render(<Catalog />);
        await until(() => text().includes('Could not load the agents'));
        expect(text()).toContain('offline');
        machine.answer('provider.registry', () => ({ catalog: LIVE }));
        await clickOn(button('Try again'));
        await until(() => text().includes('Kilo'));
        expect(machine.requests('provider.registry').at(-1)).toEqual({ refresh: true });
    });
});

const COPILOT = { kind: 'copilot', name: 'GitHub Copilot', installed: true, version: '1.0.101' } as unknown as ProviderInfo;
const CLAUDE = { kind: 'claude', name: 'Claude Code', installed: true, version: '2.1.304' } as unknown as ProviderInfo;
const GOOSE_PROVIDER = { kind: 'goose', name: 'goose', installed: true, version: '1.55.0' } as unknown as ProviderInfo;

const VERSIONS: CliVersion[] = [
    {
        provider: 'copilot',
        method: 'npm',
        package: '@github/copilot',
        path: '/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js',
        version: '1.0.101',
        latest: '1.0.110',
        updatable: true,
        state: 'idle',
        checkedAt: 1
    },
    { provider: 'claude', method: 'unknown', package: null, path: '/c', version: '2.1.304', latest: null, updatable: false, state: 'idle', checkedAt: null },
    { provider: 'goose', method: 'ruimte', package: null, path: '/g', version: '1.55.0', latest: '1.55.0', updatable: false, state: 'idle', checkedAt: 1 }
];

function Version({ provider }: { provider: ProviderInfo }) {
    const versions = useCliVersions(LOCAL_ENDPOINT_ID);
    const version = versions.versionOf(provider.kind);
    return version && <CliVersionSection provider={provider} versions={versions} version={version} />;
}

describe('the version of a CLI in Settings, Providers', () => {
    beforeEach(() => {
        machine.answer('provider.versions', () => ({ versions: VERSIONS }));
        machine.answer('provider.update', () => ({ version: { ...VERSIONS[0]!, version: '1.0.110', updatable: false } }));
        machine.answer('provider.removeAgent', () => ({ agent: { ...GOOSE, state: 'missing' as const } }));
    });

    test('says how it was installed and updates it through that route on a press', async () => {
        await page.render(<Version provider={COPILOT} />);
        await until(() => button('Update to 1.0.110') !== null);
        expect(text()).toContain('Installed with npm (@github/copilot)');
        expect(text()).toContain('Version 1.0.101. Version 1.0.110 is available.');
        await clickOn(button('Update to 1.0.110'));
        await until(() => text().includes('Version 1.0.110. Up to date.'));
        expect(machine.requests('provider.update')).toEqual([{ provider: 'copilot' }]);
    });

    test('a CLI installed some other way shows its version and no update', async () => {
        await page.render(<Version provider={CLAUDE} />);
        await until(() => text().includes('Installed some other way'));
        expect(text()).toContain('Version 2.1.304. Its own installer keeps it up to date.');
        expect(document.querySelectorAll('button')).toHaveLength(0);
    });

    test('an agent Ruimte installed can be removed again', async () => {
        await page.render(<Version provider={GOOSE_PROVIDER} />);
        await until(() => button('Remove') !== null);
        expect(text()).toContain('Installed by Ruimte');
        await clickOn(button('Remove'));
        expect(machine.requests('provider.removeAgent')).toEqual([{ id: 'goose' }]);
    });
});
