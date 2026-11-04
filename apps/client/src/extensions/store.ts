import { ExtensionManifestSchema, ExtensionPackSchema, type ExtensionManifest } from '@ruimte/contracts';
import { EXTENSION_STORE_PUBLIC_KEY, extensionStoreMessage, ExtensionStoreIndexSchema, type ExtensionStoreEntry } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { desktop } from '@/desktop/bridge';
import { syncExtensions } from '@/extensions/loader';
import { extensionRequest } from '@/extensions/machine-request';
import { currentEndpointId } from '@/state/keys';
import { machineTransport, TransportError, type Transport } from '@/transport';

const STORE_BASE = 'https://cdn.jsdelivr.net/gh/ruimte-app/extensions@main/';

export type { ExtensionStoreEntry };

export type StoreAnswer = { kind: 'entries'; entries: readonly ExtensionStoreEntry[] } | { kind: 'unavailable' } | { kind: 'closed' };

/* The store opens once its key ships; until then a person installs what someone shared as a `.rex`. */
export function storeIsOpen(): boolean {
    return EXTENSION_STORE_PUBLIC_KEY !== '';
}

/* A signature over the whole index is what ties every hash in it to the store, wherever the bytes came from. */
export async function readStore(fetcher: typeof fetch = fetch): Promise<StoreAnswer> {
    if (!storeIsOpen()) {
        return { kind: 'closed' };
    }

    try {
        const [index, signature] = await Promise.all([fetcher(`${STORE_BASE}index.json`), fetcher(`${STORE_BASE}index.sig`)]);

        if (!index.ok || !signature.ok) {
            return { kind: 'unavailable' };
        }

        const text = await index.text();
        const verified = await verifySignature(EXTENSION_STORE_PUBLIC_KEY, extensionStoreMessage(text), (await signature.text()).trim());

        return verified ? { kind: 'entries', entries: ExtensionStoreIndexSchema.parse(JSON.parse(text)).extensions } : { kind: 'unavailable' };
    } catch {
        return { kind: 'unavailable' };
    }
}

/* Over the same address as the rest of the store; the signed index names the path. */
export function storeIconUrl(entry: ExtensionStoreEntry): string | null {
    return entry.icon === undefined ? null : `${STORE_BASE}${entry.icon}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Of(bytes: Uint8Array): string {
    let binary = '';

    for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }

    return btoa(binary);
}

/*
 * The machine in front when a person pressed, taken before the first await. The shell's part of a change takes a
 * while, and a switch meanwhile must not send the rest, or the removal of `data/`, to another machine.
 */
function machineInFront(): Transport {
    return machineTransport(currentEndpointId());
}

async function installOn(link: Transport, bytes: Uint8Array, fromStore: boolean): Promise<{ onMachine: boolean }> {
    await desktop()?.extensions?.install(bytes, { fromStore });

    const onMachine = await extensionRequest(link, 'extension.install', { pack: base64Of(bytes) }).then(
        () => true,
        () => false
    );

    await syncExtensions();

    return { onMachine };
}

/*
 * The client part goes to the shell of this computer and the rest to the machine in front. A machine only
 * takes it from its owner, so on someone else's the client part still works and this says what is missing.
 */
export function installPack(bytes: Uint8Array): Promise<{ onMachine: boolean }> {
    return installOn(machineInFront(), bytes, false);
}

export async function installFromStore(entry: ExtensionStoreEntry, fetcher: typeof fetch = fetch): Promise<{ onMachine: boolean }> {
    const link = machineInFront();
    const response = await fetcher(`${STORE_BASE}${entry.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    if ((await sha256Hex(bytes)) !== entry.sha256) {
        throw new Error('This pack is not the one the store reviewed');
    }

    return installOn(link, bytes, true);
}

export interface PackPreview {
    bytes: Uint8Array;
    manifest: ExtensionManifest;
    icon: string | null;
}

function textOf(base64: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

/* What a `.rex` from a file says it is, so a person sees its name and permissions before it runs anywhere. */
export async function readPack(file: Blob): Promise<PackPreview> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const unzipped = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const pack = ExtensionPackSchema.parse(JSON.parse(await new Response(unzipped).text()));
    const manifest = pack.files['manifest.json'];

    if (manifest === undefined) {
        throw new Error('This file holds no manifest.json');
    }

    const icon = pack.files['assets/icon.svg'];

    return {
        bytes,
        manifest: ExtensionManifestSchema.parse(JSON.parse(textOf(manifest))),
        icon: icon === undefined ? null : `data:image/svg+xml;base64,${icon}`
    };
}

/*
 * What the machine said of its part of a change: null once it made it or had no such part, and why otherwise. Its
 * own list says whether it has one, since an extension with only a client part is no failure on the machine.
 */
async function changeOnMachine(link: Transport, id: string, change: () => Promise<unknown>): Promise<string | null> {
    try {
        const { extensions } = await extensionRequest(link, 'extension.list', {});

        if (extensions.some((entry) => entry.manifest.id === id)) {
            await change();
        }

        return null;
    } catch (e) {
        // A machine from before the extension API has no part to change.
        if (e instanceof TransportError && e.code === 'unavailable') {
            return null;
        }

        return e instanceof Error ? e.message : String(e);
    }
}

export interface MachineChange {
    // Why the machine kept its part as it was, so a person hears that its server part still runs.
    machineFailure: string | null;
}

export async function removeExtension(id: string): Promise<MachineChange> {
    const link = machineInFront();

    await desktop()?.extensions?.remove(id);

    const machineFailure = await changeOnMachine(link, id, () => extensionRequest(link, 'extension.remove', { id }));

    await syncExtensions();

    return { machineFailure };
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<MachineChange> {
    const link = machineInFront();

    await desktop()?.extensions?.setEnabled(id, enabled);

    const machineFailure = await changeOnMachine(link, id, () => extensionRequest(link, 'extension.setEnabled', { id, enabled }));

    await syncExtensions();

    return { machineFailure };
}
