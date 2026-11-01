import { EXTENSION_ICON_PATH, type ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { desktop } from '@/desktop/bridge';
import { wantsLoading, watchActivation } from '@/extensions/activation';
import { refreshExtensionTheme } from '@/extensions/themes';
import { create } from 'zustand';

export interface ExtensionsState {
    installed: readonly InstalledClientExtension[];
    // What failed to load, by id, shown on its row in Settings.
    failures: Readonly<Record<string, string>>;
}

export const useInstalledExtensions = create<ExtensionsState>(() => ({ installed: [], failures: {} }));

const loaded = new Map<string, string>();
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
    const bridge = desktop()?.extensions;

    if (bridge === undefined) {
        return;
    }

    const installed = await bridge.list();

    useInstalledExtensions.setState({ installed });

    if (inSafeMode()) {
        return;
    }

    await refreshExtensionTheme(installed);

    const wanted = installed.filter((entry) => entry.enabled && entry.hasClient && (loaded.has(entry.manifest.id) || wantsLoading(entry.manifest.activation)));

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
            loaded.delete(id);
        }
    }

    for (const entry of wanted) {
        if (loaded.has(entry.manifest.id)) {
            continue;
        }

        registerExtension({ manifest: entry.manifest, base: entry.base, iconUrl: extensionIconUrl(entry), dev: entry.dev, disposers: [], settings: null });
        loaded.set(entry.manifest.id, entry.base);

        try {
            await import(/* @vite-ignore */ `${entry.base}client/index.js`);
            useInstalledExtensions.setState(({ failures: { [entry.manifest.id]: _cleared, ...failures } }) => ({ failures }));
        } catch (e) {
            forgetExtension(entry.manifest.id);
            loaded.delete(entry.manifest.id);
            failed(entry.manifest.id, e);

            if (entry.dev) {
                const { sendDevLog } = await import('@/extensions/dev-log');

                sendDevLog(entry.manifest.id, 'error', [e]);
            }
        }
    }
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
