import { EXTENSION_FILES_PATH } from '@ruimte/csp';
import type { ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import type { Transport } from '@/transport';

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
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/* Puts one extension where its address answers. A hash in the path means a version already there is never fetched twice. */
async function cached(link: Pick<Transport, 'request'>, info: ExtensionInfo, base: string): Promise<boolean> {
    const cache = await caches.open(CACHE);

    if ((await cache.match(`${base}manifest.json`)) !== undefined) {
        return (await cache.match(`${base}assets/icon.svg`)) !== undefined;
    }

    const { files } = await link.request('extension.clientFiles', { id: info.manifest.id });

    await Promise.all(
        Object.entries(files).map(([path, content]) =>
            cache.put(
                `${base}${path}`,
                new Response(bytesOf(content), { headers: { 'content-type': MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream' } })
            )
        )
    );

    return files['assets/icon.svg'] !== undefined;
}

/* What the machine in front has, for a client with no shell to keep files. */
export async function machineExtensions(link: Pick<Transport, 'request'>): Promise<InstalledClientExtension[]> {
    await workerReady();

    const { extensions } = await link.request('extension.list', {});

    return Promise.all(
        extensions.map(async (info) => {
            const base = `${EXTENSION_FILES_PATH}${info.manifest.id}/${info.hash}/`;

            return {
                manifest: info.manifest,
                base,
                enabled: info.enabled,
                hasClient: info.hasClient === true,
                hasIcon: await cached(link, info, base),
                dev: false
            };
        })
    );
}
