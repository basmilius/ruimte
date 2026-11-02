import { EXTENSION_FILES_PATH } from '@ruimte/csp';
import type { ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { extensionRequest } from '@/extensions/machine-request';
import type { Transport } from '@/transport';
import { machineAnswers } from '@/transport/features';

const CACHE = 'ruimte-extension-files';
const WORKER = '/extension-files-sw.js';

const MIME: Readonly<Record<string, string>> = {
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    html: 'text/html; charset=utf-8'
};

async function workerReady(): Promise<void> {
    await navigator.serviceWorker.register(WORKER);
    await navigator.serviceWorker.ready;

    // Active is not yet in charge of this page, and an import before that misses the worker.
    if (navigator.serviceWorker.controller === null) {
        const inCharge = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));

        // A forced reload leaves an active worker out of charge, and only asking brings it back.
        (await navigator.serviceWorker.ready).active?.postMessage('claim');
        await inCharge;
    }
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function put(cache: Cache, base: string, files: Readonly<Record<string, string>>): Promise<void> {
    await Promise.all(
        Object.entries(files).map(([path, content]) =>
            cache.put(
                `${base}${path}`,
                new Response(bytesOf(content), { headers: { 'content-type': MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream' } })
            )
        )
    );
}

async function digestOf(files: Readonly<Record<string, string>>): Promise<string> {
    const text = JSON.stringify(Object.entries(files).sort(([one], [other]) => one.localeCompare(other)));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

    return [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/*
 * Puts one extension where its address answers, under the machine it came from. A hash in the path means a version
 * already there is never fetched twice. A dev link counts its builds from 0 again when its machine restarts, so its
 * address is named by what it holds.
 */
async function cached(link: Pick<Transport, 'request' | 'connection'>, info: ExtensionInfo, root: string): Promise<{ base: string; hasIcon: boolean }> {
    const cache = await caches.open(CACHE);
    const dev = info.hash.startsWith('dev-');
    const kept = `${root}${info.manifest.id}/${info.hash}/`;

    if (!dev && (await cache.match(`${kept}manifest.json`)) !== undefined) {
        return { base: kept, hasIcon: (await cache.match(`${kept}assets/icon.svg`)) !== undefined };
    }

    const { files } = await extensionRequest(link, 'extension.clientFiles', { id: info.manifest.id });
    const base = dev ? `${root}${info.manifest.id}/dev-${await digestOf(files)}/` : kept;

    await put(cache, base, files);

    return { base, hasIcon: files['assets/icon.svg'] !== undefined };
}

/* Only under this machine: another window of the page may run what another machine has. */
async function dropOtherVersions(root: string, bases: readonly string[]): Promise<void> {
    const cache = await caches.open(CACHE);

    for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url);

        if (pathname.startsWith(root) && !bases.some((base) => pathname.startsWith(base))) {
            await cache.delete(request);
        }
    }
}

/* What the machine in front has, for a client with no shell to keep files. */
export async function machineExtensions(link: Pick<Transport, 'request' | 'connection'>, endpointId: string): Promise<InstalledClientExtension[]> {
    if (!machineAnswers(link.connection, 'extension.clientFiles')) {
        return [];
    }

    await workerReady();

    const root = `${EXTENSION_FILES_PATH}${encodeURIComponent(endpointId)}/`;
    const { extensions } = await extensionRequest(link, 'extension.list', {});
    const installed = await Promise.all(
        extensions.map(async (info) => {
            const { base, hasIcon } = await cached(link, info, root);

            return {
                manifest: info.manifest,
                base,
                enabled: info.enabled,
                hasClient: info.hasClient === true,
                hasIcon,
                dev: false
            };
        })
    );

    await dropOtherVersions(
        root,
        installed.map((entry) => entry.base)
    );

    return installed;
}
