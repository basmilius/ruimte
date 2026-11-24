import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { ExtensionsPane } from '@/extensions/ExtensionsPane';
import { useInstalledExtensions } from '@/extensions/loader';
import { useToasts } from '@/state/toasts';
import { mount, until, type Mounted } from '../../testing/dom';

function installed(id: string, name: string, dev: boolean): InstalledClientExtension {
    return { manifest: { id, name, version: '1.0.0', api: 1, publisher: 'Acme' }, base: `/__extensions/${id}/x/`, enabled: true, hasClient: true, dev };
}

const INSTALLED = [installed('acme.store', 'From the store', false), installed('acme.dev', 'Being built', true), installed('poc.probe', 'Probe', true)];
// As the machine tells it: the manifest of `acme.dev` could say anything and stays a dev link.
const PROVENANCE = { 'acme.store': 'installed', 'acme.dev': 'dev-link', 'poc.probe': 'development' } as const;

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
    return [...root.querySelectorAll('button')].find((button) => button.textContent === name);
}

/* Opens the pack in "Install from disk" and returns the packs that reached the desktop's install. */
async function previewPack(manifest: Record<string, unknown>): Promise<Uint8Array[]> {
    const pack = { files: { 'manifest.json': Buffer.from(JSON.stringify(manifest)).toString('base64') } };
    const installs: Uint8Array[] = [];

    windowWithBridge.ruimteDesktop = {
        extensions: {
            list: async () => INSTALLED,
            install: async (bytes: Uint8Array) => void installs.push(bytes)
        }
    };
    await mounted.render(<ExtensionsPane />);
    buttonNamed(mounted.host, 'Install from disk')?.click();
    await until(() => mounted.host.querySelector('input[type="file"]') !== null);

    const input = mounted.host.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File([Bun.gzipSync(JSON.stringify(pack))], 'local.rex');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => mounted.host.textContent?.includes(String(manifest.version)) ?? false);

    return installs;
}

let mounted: Mounted;
const windowWithBridge = window as unknown as { ruimteDesktop?: unknown };
const before = windowWithBridge.ruimteDesktop;

beforeEach(() => {
    mounted = mount();
    windowWithBridge.ruimteDesktop = { extensions: { list: async () => INSTALLED } };
    useInstalledExtensions.setState({ installed: INSTALLED, failures: {}, provenance: PROVENANCE });
});
afterEach(async () => {
    await mounted.unmount();
    windowWithBridge.ruimteDesktop = before;
    useInstalledExtensions.setState({ installed: [], failures: {}, provenance: {} });
});

describe('the list of extensions', () => {
    test('has the store, then what you are building, the test extensions, what you installed and what is built in', async () => {
        await mounted.render(<ExtensionsPane />);
        await until(() => mounted.host.textContent?.includes('Being built') ?? false);

        const nav = mounted.host.querySelector('nav')?.textContent ?? '';
        const places = ['Browse store', 'In development', 'Being built', 'Test extensions', 'Probe', 'Installed', 'From the store', 'Built-in', 'Pets'].map(
            (word) => nav.indexOf(word)
        );

        expect(places).not.toContain(-1);
        expect(places).toEqual([...places].sort((left, right) => left - right));
    });

    test('has no group of test extensions on a machine that names none', async () => {
        useInstalledExtensions.setState({ provenance: { 'acme.dev': 'dev-link', 'poc.probe': 'dev-link' } });
        await mounted.render(<ExtensionsPane />);
        await until(() => mounted.host.textContent?.includes('Being built') ?? false);

        expect(mounted.host.querySelector('nav')?.textContent).not.toContain('Test extensions');
        expect(mounted.host.querySelector('nav')?.textContent).toContain('Probe');
    });

    test('lets a person turn a test extension on and off, and leaves a dev link to its run', async () => {
        const turned: [string, boolean][] = [];
        const enabledSwitch = () => mounted.host.querySelector<HTMLElement>('[role="switch"][aria-label="On"]');

        windowWithBridge.ruimteDesktop = {
            extensions: { list: async () => INSTALLED, setEnabled: async (id: string, enabled: boolean) => void turned.push([id, enabled]) }
        };
        await mounted.render(<ExtensionsPane />);
        buttonNamed(mounted.host, 'Being built')?.click();
        await until(() => enabledSwitch() !== null);

        expect(enabledSwitch()?.hasAttribute('data-disabled')).toBe(true);

        buttonNamed(mounted.host, 'Probe')?.click();
        await until(() => mounted.host.textContent?.includes('Test extension') ?? false);
        await until(() => enabledSwitch()?.hasAttribute('data-disabled') === false);
        enabledSwitch()?.click();
        await until(() => turned.length === 1);

        expect(turned).toEqual([['poc.probe', false]]);
    });
});

function manifestOf(permissions: Record<string, string>) {
    return { id: 'acme.local', name: 'Local pack', version: '0.2.0', api: 1, permissions };
}

async function chooseFile(manifest: object): Promise<void> {
    const pack = { files: { 'manifest.json': Buffer.from(JSON.stringify(manifest)).toString('base64') } };

    await mounted.render(<ExtensionsPane />);
    [...mounted.host.querySelectorAll('button')].find((button) => button.textContent === 'Install from disk')?.click();
    await until(() => mounted.host.querySelector('input[type="file"]') !== null);

    const input = mounted.host.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File([Bun.gzipSync(JSON.stringify(pack))], 'local.rex');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('installing from a file', () => {
    test('shows what the pack is and asks for before it installs it', async () => {
        const installs = await previewPack({
            id: 'acme.local',
            name: 'Local pack',
            version: '0.2.0',
            api: 1,
            permissions: { 'files.read': 'Reads your notes' }
        });

        expect(mounted.host.textContent).toContain('Local pack');
        expect(mounted.host.textContent).toContain('Reads your notes');
        expect(mounted.host.textContent).not.toContain('Updates');
        expect(installs).toHaveLength(0);

        buttonNamed(mounted.host, 'Install')?.click();
        await until(() => installs.length === 1);
    });

    test('says which installed extension a pack with its id updates, and installs it on one click from the same publisher', async () => {
        const installs = await previewPack({ id: 'acme.store', name: 'Store pack', version: '2.0.0', api: 1, publisher: 'Acme' });

        expect(mounted.host.textContent).toContain('acme.store');
        expect(mounted.host.textContent).toContain('Updates From the store to version 2.0.0.');

        buttonNamed(mounted.host, 'Install')?.click();
        await until(() => installs.length === 1);
    });

    test('asks again before a pack from another publisher takes over an installed extension', async () => {
        const installs = await previewPack({ id: 'acme.store', name: 'Look-alike', version: '2.0.0', api: 1, publisher: 'Mallory' });

        buttonNamed(mounted.host, 'Install')?.click();
        await until(() => document.body.textContent?.includes('comes from Acme, this pack from Mallory') ?? false);

        expect(installs).toHaveLength(0);

        buttonNamed(document.body, 'Replace')?.click();
        await until(() => installs.length === 1);
    });

    test('refuses a pack that asks for a permission Ruimte does not know, as the machine would', async () => {
        const refused = () => useToasts.getState().toasts.some((toast) => toast.description?.includes('ui.canvasOverlay is not a permission'));

        await chooseFile(manifestOf({ 'files.read': 'Reads your notes', 'ui.canvasOverlay': 'Walks over the canvas' }));
        // The install of the test before can still toast after this one began, so the toast is found by what it says.
        await until(refused);

        expect(mounted.host.textContent).not.toContain('Local pack');
    });
});
