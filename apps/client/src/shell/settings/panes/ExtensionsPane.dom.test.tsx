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

describe('installing from a file', () => {
    test('shows what the pack is and asks for before it installs it', async () => {
        const manifest = {
            id: 'acme.local',
            name: 'Local pack',
            version: '0.2.0',
            api: 1,
            permissions: { 'files.read': 'Reads your notes', 'ui.canvasOverlay': 'Walks over the canvas' }
        };
        const pack = { files: { 'manifest.json': Buffer.from(JSON.stringify(manifest)).toString('base64') } };
        const installs: Uint8Array[] = [];

        windowWithBridge.ruimteDesktop = {
            extensions: {
                list: async () => INSTALLED,
                install: async (bytes: Uint8Array) => void installs.push(bytes)
            }
        };
        await mounted.render(<ExtensionsPane />);

        expect(mounted.host.querySelector('input[type="file"]')).toBeNull();
        [...mounted.host.querySelectorAll('button')].find((button) => button.textContent === 'Install from disk')?.click();
        await until(() => mounted.host.querySelector('input[type="file"]') !== null);

        const input = mounted.host.querySelector<HTMLInputElement>('input[type="file"]');
        const file = new File([Bun.gzipSync(JSON.stringify(pack))], 'local.rex');

        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input?.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => mounted.host.textContent?.includes('Local pack') ?? false);

        expect(mounted.host.textContent).toContain('Reads your notes');
        // A name that opens nothing is no permission to show a person.
        expect(mounted.host.textContent).not.toContain('Walks over the canvas');
        expect(installs).toHaveLength(0);

        const install = [...mounted.host.querySelectorAll('button')].find((button) => button.textContent === 'Install');

        install?.click();
        await until(() => installs.length === 1);
    });
});
