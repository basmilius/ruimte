import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CliVersion, ProviderInfo, RegistryAgent, RegistryCatalog } from '@ruimte/contracts';
import { CliVersionSection } from '@/shell/settings/providers/CliVersionSection';
import { RegistryCatalogPage } from '@/shell/settings/providers/RegistryCatalogPage';
import { useCliVersions, useRegistryCatalog } from '@/shell/settings/providers/use-provider-installs';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../../../testing/dom-helpers';
import { FakeMachine, connectFakeMachine } from '../../../../testing/fake-machine';

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
        await until(() => everything().includes('Kilo'));
        expect(everything()).toContain('goose');
        expect(everything()).toContain('Version 1.55.0 · verified');
        expect(everything()).toContain('Version 7.8.15');
        expect(everything()).not.toContain('npm package');

        await typeInto(document.querySelector('input')!, 'open source');
        await until(() => !everything().includes('A local, extensible agent'));
        expect(everything()).toContain('Kilo');

        await typeInto(document.querySelector('input')!, 'nothing like it');
        await until(() => everything().includes('No agent matches "nothing like it".'));
    });

    test('installs an agent on a press, asks for the providers again and opens it', async () => {
        await page.render(<Catalog />);
        await until(() => buttonWithText('Install') !== null);
        const listsBefore = machine.requests('provider.list').length;
        await clickOn(buttonWithText('Install'));
        await until(() => buttonWithText('Open') !== null);
        expect(machine.requests('provider.installAgent')).toEqual([{ id: 'goose' }]);
        expect(machine.requests('provider.list').length).toBeGreaterThan(listsBefore);
        await clickOn(buttonWithText('Open'));
        expect(opened).toEqual(['goose']);
    });

    test('shows the last good catalog when the registry cannot be reached, and says why', async () => {
        machine.answer('provider.registry', () => ({ catalog: { ...LIVE, source: 'cached' as const, error: 'The list of agents is unavailable (503)' } }));
        await page.render(<Catalog />);
        await until(() => everything().includes('Could not refresh the list (The list of agents is unavailable (503)).'));
        expect(everything()).toContain('Kilo');
    });

    test('says what went wrong when there is no catalog at all, and tries again on a press', async () => {
        machine.answer('provider.registry', () => ({
            catalog: { source: 'unavailable' as const, fetchedAt: null, error: 'offline', platform: 'darwin-aarch64', agents: [] }
        }));
        await page.render(<Catalog />);
        await until(() => everything().includes('Could not load the agents'));
        expect(everything()).toContain('offline');
        machine.answer('provider.registry', () => ({ catalog: LIVE }));
        await clickOn(buttonWithText('Try again'));
        await until(() => everything().includes('Kilo'));
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
        await until(() => buttonWithText('Update to 1.0.110') !== null);
        expect(everything()).toContain('Installed with npm (@github/copilot)');
        expect(everything()).toContain('Version 1.0.101. Version 1.0.110 is available.');
        await clickOn(buttonWithText('Update to 1.0.110'));
        await until(() => everything().includes('Version 1.0.110. Up to date.'));
        expect(machine.requests('provider.update')).toEqual([{ provider: 'copilot' }]);
    });

    test('a CLI installed some other way shows its version and no update', async () => {
        await page.render(<Version provider={CLAUDE} />);
        await until(() => everything().includes('Installed some other way'));
        expect(everything()).toContain('Version 2.1.304. Its own installer keeps it up to date.');
        expect(document.querySelectorAll('button')).toHaveLength(0);
    });

    test('an agent Ruimte installed can be removed again', async () => {
        await page.render(<Version provider={GOOSE_PROVIDER} />);
        await until(() => buttonWithText('Remove') !== null);
        expect(everything()).toContain('Installed by Ruimte');
        await clickOn(buttonWithText('Remove'));
        expect(machine.requests('provider.removeAgent')).toEqual([{ id: 'goose' }]);
    });
});
