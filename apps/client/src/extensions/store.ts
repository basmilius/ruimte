import { EXTENSION_STORE_PUBLIC_KEY, extensionStoreMessage, ExtensionStoreIndexSchema, type ExtensionStoreEntry } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { desktop } from '@/desktop/bridge';
import { syncExtensions } from '@/extensions/loader';
import { transport } from '@/transport';

const STORE_BASE = 'https://cdn.jsdelivr.net/gh/ruimte-app/extensions@main/';

export type { ExtensionStoreEntry };

export type StoreAnswer = { kind: 'entries'; entries: readonly ExtensionStoreEntry[] } | { kind: 'unavailable' };

/* A signature over the whole index is what ties every hash in it to the store, wherever the bytes came from. */
export async function readStore(fetcher: typeof fetch = fetch): Promise<StoreAnswer> {
    if (EXTENSION_STORE_PUBLIC_KEY === '') {
        return { kind: 'unavailable' };
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
 * The client part goes to the shell of this computer and the rest to the machine in front. A machine only
 * takes it from its owner, so on someone else's the client part still works and this says what is missing.
 */
export async function installPack(bytes: Uint8Array): Promise<{ onMachine: boolean }> {
    await desktop()?.extensions?.install(bytes);

    const onMachine = await transport.request('extension.install', { pack: base64Of(bytes) }).then(
        () => true,
        () => false
    );

    await syncExtensions();

    return { onMachine };
}

export async function installFromStore(entry: ExtensionStoreEntry, fetcher: typeof fetch = fetch): Promise<{ onMachine: boolean }> {
    const response = await fetcher(`${STORE_BASE}${entry.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    if ((await sha256Hex(bytes)) !== entry.sha256) {
        throw new Error('This pack is not the one the store reviewed');
    }

    return installPack(bytes);
}

export async function removeExtension(id: string): Promise<void> {
    await desktop()?.extensions?.remove(id);
    await transport.request('extension.remove', { id }).catch(() => undefined);
    await syncExtensions();
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    await desktop()?.extensions?.setEnabled(id, enabled);
    await transport.request('extension.setEnabled', { id, enabled }).catch(() => undefined);
    await syncExtensions();
}
