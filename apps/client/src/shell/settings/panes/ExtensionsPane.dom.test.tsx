import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { useInstalledExtensions } from '@/extensions/loader';
import { ExtensionsPane } from '@/shell/settings/panes/ExtensionsPane';
import { mount, until, type Mounted } from '../../../../testing/dom';

function installed(id: string, name: string, dev: boolean): InstalledClientExtension {
    return { manifest: { id, name, version: '1.0.0', api: 1 }, base: `/__extensions/${id}/x/`, enabled: true, hasClient: true, dev };
}

const INSTALLED = [installed('acme.store', 'From the store', false), installed('acme.dev', 'Being built', true)];

let mounted: Mounted;
const windowWithBridge = window as unknown as { ruimteDesktop?: unknown };
const before = windowWithBridge.ruimteDesktop;

beforeEach(() => {
    mounted = mount();
    windowWithBridge.ruimteDesktop = { extensions: { list: async () => INSTALLED } };
    useInstalledExtensions.setState({ installed: INSTALLED, failures: {} });
});
afterEach(async () => {
    await mounted.unmount();
    windowWithBridge.ruimteDesktop = before;
    useInstalledExtensions.setState({ installed: [], failures: {} });
});

describe('the list of extensions', () => {
    test('has the store, then what you are building, what you installed and what is built in', async () => {
        await mounted.render(<ExtensionsPane />);
        await until(() => mounted.host.textContent?.includes('Being built') ?? false);

        const nav = mounted.host.querySelector('nav')?.textContent ?? '';
        const places = ['Browse store', 'In development', 'Being built', 'Installed', 'From the store', 'Built-in', 'Pets'].map((word) => nav.indexOf(word));

        expect(places).not.toContain(-1);
        expect(places).toEqual([...places].sort((left, right) => left - right));
    });
});
