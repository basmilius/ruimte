import { EXTENSION_ICON_PATH, type ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { desktop } from '@/desktop/bridge';
import { machineExtensions } from '@/extensions/station-files';
import { extensionsInSafeMode } from '@/extensions/safe-mode';
import { IS_STATION } from '@/station';
import { useEndpoints } from '@/state/endpoints';
import { machineTransport } from '@/transport';
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

type Runtime = typeof import('@/extensions/host/runtime');

const loaded = new Map<string, string>();
/*
 * Each version as it was first loaded, by its base. A module the page already ran is never run again for the same
 * address, so turning a version on again imports its entry under a new one and hands it the same extension, which is
 * how the runtime knows a chunk kept from before belongs to the load in place.
 */
const versions = new Map<string, { extension: LoadedExtension; imports: number }>();
// By id, while its stylesheet and module load.
const loading = new Set<string>();
let stopActivation: (() => void) | null = null;
// Counts the syncs begun, so one whose list came in after a newer one began leaves the newer one's to apply.
let syncs = 0;

export { extensionsInSafeMode };

export function extensionIconUrl(entry: InstalledClientExtension): string | null {
    return entry.hasIcon === true ? `${entry.base}${EXTENSION_ICON_PATH}` : null;
}

function failed(id: string, e: unknown): void {
    useInstalledExtensions.setState((state) => ({ failures: { ...state.failures, [id]: e instanceof Error ? e.message : String(e) } }));
}

/*
 * What this computer has. On Station that is what the machine in front has, over that machine's own link for the whole
 * read; an extension whose files did not come keeps the version it had, with why on its row.
 */
async function installedNow(): Promise<{ installed: readonly InstalledClientExtension[]; failures: Record<string, string> } | null> {
    if (!IS_STATION) {
        const installed = (await desktop()?.extensions?.list()) ?? null;

        return installed === null ? null : { installed, failures: {} };
    }

    const endpointId = useEndpoints.getState().activeId;
    const answer = await machineExtensions(machineTransport(endpointId), endpointId).catch(() => null);

    if (answer === null) {
        return null;
    }

    const kept = useInstalledExtensions
        .getState()
        .installed.filter(
            (entry) => Object.hasOwn(answer.failures, entry.manifest.id) && !answer.installed.some((each) => each.manifest.id === entry.manifest.id)
        );

    return { installed: [...answer.installed, ...kept], failures: answer.failures };
}

/* Loads what is on and new, and takes down what went or moved to another version. One extension failing leaves the others alone. */
export async function syncExtensions(): Promise<void> {
    const sync = ++syncs;
    const answer = await installedNow();

    if (answer === null || sync !== syncs) {
        return;
    }

    const { installed } = answer;

    useInstalledExtensions.setState({ installed });

    for (const [id, failure] of Object.entries(answer.failures)) {
        failed(id, failure);
    }

    if (extensionsInSafeMode()) {
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

    const runtime = await import('@/extensions/host/runtime');

    if (sync !== syncs) {
        return;
    }

    for (const [id, base] of [...loaded]) {
        if (!wanted.some((entry) => entry.manifest.id === id && entry.base === base)) {
            runtime.forgetExtension(id);
            dropStylesheet(id);
            loaded.delete(id);
        }
    }

    // A load still under way that was taken down settles first, and syncs again once it has.
    const fresh = wanted.filter((entry) => !loaded.has(entry.manifest.id) && !loading.has(entry.manifest.id));

    // Each on its own, so a module whose top-level await never ends holds up only itself.
    await Promise.all(fresh.map((entry) => load(entry, runtime)));
}

async function load(entry: InstalledClientExtension, { registerExtension, forgetExtension }: Runtime): Promise<void> {
    const { id } = entry.manifest;
    const version = versions.get(entry.base) ?? {
        extension: { manifest: entry.manifest, base: entry.base, iconUrl: extensionIconUrl(entry), dev: entry.dev, disposers: [], settings: null },
        imports: 0
    };
    const address = `${entry.base}client/index.js${version.imports === 0 ? '' : `?load=${version.imports}`}`;

    version.imports += 1;
    versions.set(entry.base, version);

    const current = registerExtension(version.extension);

    let failedToLoad = false;

    loaded.set(id, entry.base);
    loading.add(id);

    try {
        await linkStylesheet(id, entry.base);

        if (!current()) {
            dropStylesheet(id);

            return;
        }

        await import(/* @vite-ignore */ address);
        useInstalledExtensions.setState(({ failures: { [id]: _cleared, ...failures } }) => ({ failures }));
    } catch (e) {
        // Taken down while it loaded: what failed is a load nobody wants any more.
        if (!current()) {
            return;
        }

        failedToLoad = true;
        forgetExtension(id);
        dropStylesheet(id);
        loaded.delete(id);
        failed(id, e);

        if (entry.dev) {
            const { sendDevLog } = await import('@/extensions/dev-log');

            sendDevLog(id, 'error', [e]);
        }
    } finally {
        loading.delete(id);

        if (!failedToLoad && !current()) {
            void syncExtensions();
        }
    }
}

function stylesheetId(id: string): string {
    return `ruimte-extension-css-${id}`;
}

/*
 * The CSS the client part imported, bundled into one file. Linked and loaded before the code runs, so its first frame
 * is styled. A sheet that fails to load leaves the code to run unstyled rather than not at all.
 */
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
    const settled = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
    });

    link.id = stylesheetId(id);
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
    await settled;
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
