import { EXTENSION_ICON_PATH, type ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { desktop } from '@/desktop/bridge';
import { machineExtensions } from '@/extensions/station-files';
import { IS_STATION } from '@/station';
import { useEndpoints } from '@/state/endpoints';
import { transport } from '@/transport';
import { wantsLoading, watchActivation } from '@/extensions/activation';
import { refreshExtensionTheme } from '@/extensions/themes';
import { create } from 'zustand';
import type { LoadedExtension } from '@/extensions/host/client-api';

export interface ExtensionsState {
    installed: readonly InstalledClientExtension[];
    // What failed to load, by id, shown on its row in Settings.
    failures: Readonly<Record<string, string>>;
}

export const useInstalledExtensions = create<ExtensionsState>(() => ({ installed: [], failures: {} }));

const loaded = new Map<string, string>();
/*
 * Each version as it was first loaded, by its base. A module the page already ran is never run again for the same
 * address, so turning a version on again imports its entry under a new one and hands it the same extension: a chunk
 * kept from before still holds the client it was given then.
 */
const versions = new Map<string, { extension: LoadedExtension; imports: number }>();
// By id, while its stylesheet and module load.
const loading = new Set<string>();
let safeMode = false;
let stopActivation: (() => void) | null = null;

/* `ruimte --safe-mode` sets this on the window's address, so a person can always get back into an app an extension hangs. */
function inSafeMode(): boolean {
    return safeMode || new URLSearchParams(window.location.search).has('safe-mode');
}

export function extensionIconUrl(entry: InstalledClientExtension): string | null {
    return entry.hasIcon === true ? `${entry.base}${EXTENSION_ICON_PATH}` : null;
}

export function extensionsInSafeMode(): boolean {
    return inSafeMode();
}

export function startInSafeMode(): void {
    safeMode = true;
}

function failed(id: string, e: unknown): void {
    useInstalledExtensions.setState((state) => ({ failures: { ...state.failures, [id]: e instanceof Error ? e.message : String(e) } }));
}

/* Loads what is on and new, and takes down what went or moved to another version. One extension failing leaves the others alone. */
export async function syncExtensions(): Promise<void> {
    const installed = IS_STATION
        ? await machineExtensions(transport, useEndpoints.getState().activeId).catch(() => null)
        : ((await desktop()?.extensions?.list()) ?? null);

    if (installed === null) {
        return;
    }

    useInstalledExtensions.setState({ installed });

    if (inSafeMode()) {
        return;
    }

    await refreshExtensionTheme(installed);

    const wanted = installed.filter(
        (entry) => entry.enabled && entry.hasClient && (loaded.has(entry.manifest.id) || wantsLoading(entry.manifest.id, entry.manifest.activation))
    );

    if (installed.some((entry) => entry.manifest.activation !== undefined) && stopActivation === null) {
        stopActivation = watchActivation(() => void syncExtensions());
    }

    if (wanted.length === 0 && loaded.size === 0) {
        return;
    }

    const { forgetExtension, registerExtension } = await import('@/extensions/host/runtime');

    for (const [id, base] of [...loaded]) {
        if (!wanted.some((entry) => entry.manifest.id === id && entry.base === base)) {
            forgetExtension(id);
            dropStylesheet(id);
            loaded.delete(id);
        }
    }

    for (const entry of wanted) {
        // A load still under way that was taken down settles first, and syncs again once it has.
        if (loaded.has(entry.manifest.id) || loading.has(entry.manifest.id)) {
            continue;
        }

        const version = versions.get(entry.base) ?? {
            extension: { manifest: entry.manifest, base: entry.base, iconUrl: extensionIconUrl(entry), dev: entry.dev, disposers: [], settings: null },
            imports: 0
        };
        const address = `${entry.base}client/index.js${version.imports === 0 ? '' : `?load=${version.imports}`}`;

        version.imports += 1;
        versions.set(entry.base, version);

        const current = registerExtension(version.extension);

        let failedToLoad = false;

        loaded.set(entry.manifest.id, entry.base);
        loading.add(entry.manifest.id);

        try {
            await linkStylesheet(entry.manifest.id, entry.base);

            if (!current()) {
                dropStylesheet(entry.manifest.id);
                continue;
            }

            await import(/* @vite-ignore */ address);
            useInstalledExtensions.setState(({ failures: { [entry.manifest.id]: _cleared, ...failures } }) => ({ failures }));
        } catch (e) {
            // Taken down while it loaded: what failed is a load nobody wants any more.
            if (!current()) {
                continue;
            }

            failedToLoad = true;
            forgetExtension(entry.manifest.id);
            dropStylesheet(entry.manifest.id);
            loaded.delete(entry.manifest.id);
            failed(entry.manifest.id, e);

            if (entry.dev) {
                const { sendDevLog } = await import('@/extensions/dev-log');

                sendDevLog(entry.manifest.id, 'error', [e]);
            }
        } finally {
            loading.delete(entry.manifest.id);

            if (!failedToLoad && !current()) {
                void syncExtensions();
            }
        }
    }
}

function stylesheetId(id: string): string {
    return `ruimte-extension-css-${id}`;
}

/* The CSS the client part imported, bundled into one file. Linked before the code runs, so its first frame is styled. */
async function linkStylesheet(id: string, base: string): Promise<void> {
    const href = `${base}client/index.css`;
    const exists = await fetch(href, { method: 'HEAD' }).then(
        (answer) => answer.ok,
        () => false
    );

    if (!exists) {
        return;
    }

    const link = document.createElement('link');

    link.id = stylesheetId(id);
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
}

function dropStylesheet(id: string): void {
    document.getElementById(stylesheetId(id))?.remove();
}

/* What `ruimte extension dev` linked on this machine. A window on another machine has no such folder to read. */
export async function followDevLinks(machineExtensions: readonly ExtensionInfo[]): Promise<void> {
    const bridge = desktop()?.extensions;

    if (bridge === undefined) {
        return;
    }

    const linked = machineExtensions.filter((entry) => entry.devFolder !== undefined);
    const known = await bridge.list();

    for (const entry of known.filter((each) => each.dev && !linked.some((link) => link.manifest.id === each.manifest.id))) {
        await bridge.unlink(entry.manifest.id);
    }

    for (const entry of linked) {
        await bridge.link(entry.devFolder as string, entry.revision ?? 0);
    }

    await syncExtensions();
}
