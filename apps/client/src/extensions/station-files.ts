import { EXTENSION_FILE_TYPES, EXTENSION_FILES_PATH } from '@ruimte/csp';
import type { ExtensionInfo } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { extensionRequest } from '@/extensions/machine-request';
import type { Transport } from '@/transport';
import { machineAnswers } from '@/transport/features';

const CACHE = 'ruimte-extension-files';
const WORKER = '/extension-files-sw.js';
// Put after every other file of a version, so a version without it was never filled to the end.
const COMPLETE = '.complete';
const LOCK_PREFIX = 'ruimte-extension-files:';
// A list that moved on while its files were fetched is read again, a few times at most.
const LIST_ATTEMPTS = 3;

type Link = Pick<Transport, 'request' | 'connection'>;

export interface MachineExtensions {
    installed: InstalledClientExtension[];
    // Why the files of an extension did not arrive, by id; the others load all the same.
    failures: Record<string, string>;
}

/* The machine updated an extension between its list and its files, so this list is not the one its files belong to. */
class MovedOn extends Error {}

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

async function dropUnder(cache: Cache, base: string): Promise<void> {
    for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith(base)) {
            await cache.delete(request);
        }
    }
}

/* Every file, then the mark that says they are all there. A put that fails takes the rest of the version with it. */
async function put(cache: Cache, base: string, files: Readonly<Record<string, string>>): Promise<void> {
    try {
        await Promise.all(
            Object.entries(files).map(([path, content]) =>
                cache.put(
                    `${base}${path}`,
                    new Response(bytesOf(content), {
                        headers: { 'content-type': EXTENSION_FILE_TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream' }
                    })
                )
            )
        );
        await cache.put(`${base}${COMPLETE}`, new Response(''));
    } catch (e) {
        await dropUnder(cache, base);

        throw e;
    }
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
async function cached(link: Link, info: ExtensionInfo, root: string): Promise<{ base: string; hasIcon: boolean }> {
    const cache = await caches.open(CACHE);
    const dev = info.hash.startsWith('dev-');
    const kept = `${root}${info.manifest.id}/${info.hash}/`;

    if (!dev && (await cache.match(`${kept}${COMPLETE}`)) !== undefined) {
        return { base: kept, hasIcon: (await cache.match(`${kept}assets/icon.svg`)) !== undefined };
    }

    const { hash, files } = await extensionRequest(link, 'extension.clientFiles', { id: info.manifest.id });

    if (hash !== info.hash) {
        throw new MovedOn(`${info.manifest.id} changed while its files were read`);
    }

    const base = dev ? `${root}${info.manifest.id}/dev-${await digestOf(files)}/` : kept;

    await put(cache, base, files);

    return { base, hasIcon: files['assets/icon.svg'] !== undefined };
}

/*
 * Each window of the page holds a shared lock on every version it runs, which the browser lets go with the window. A
 * version another window still holds stays, or its lazy chunks would no longer be found.
 */
const heldVersions = new Map<string, () => void>();

// Only a page served over https has locks; without them every window keeps to what it runs itself.
function pageLocks(): LockManager | null {
    return (navigator.locks as LockManager | null | undefined) ?? null;
}

function holdVersions(bases: readonly string[]): void {
    const locks = pageLocks();

    if (locks === null) {
        return;
    }

    for (const [base, release] of heldVersions) {
        if (!bases.includes(base)) {
            release();
            heldVersions.delete(base);
        }
    }

    for (const base of bases.filter((each) => !heldVersions.has(each))) {
        const held = new Promise<void>((resolve) => heldVersions.set(base, resolve));

        void locks.request(`${LOCK_PREFIX}${base}`, { mode: 'shared' }, () => held);
    }
}

async function versionsInUse(): Promise<string[]> {
    const locks = pageLocks();

    if (locks === null) {
        return [];
    }

    const { held = [] } = await locks.query();

    return held.flatMap((lock) => (lock.name?.startsWith(LOCK_PREFIX) === true ? [lock.name.slice(LOCK_PREFIX.length)] : []));
}

/* Only under this machine: another window of the page may run what another machine has. */
async function dropOtherVersions(root: string, bases: readonly string[]): Promise<void> {
    const cache = await caches.open(CACHE);
    const keep = [...bases, ...(await versionsInUse())];

    for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url);

        if (pathname.startsWith(root) && !keep.some((base) => pathname.startsWith(base))) {
            await cache.delete(request);
        }
    }
}

async function read(link: Link, root: string): Promise<MachineExtensions> {
    for (let attempt = 1; ; attempt++) {
        const { extensions } = await extensionRequest(link, 'extension.list', {});
        const settled = await Promise.allSettled(extensions.map((info) => cached(link, info, root)));

        if (attempt < LIST_ATTEMPTS && settled.some((outcome) => outcome.status === 'rejected' && outcome.reason instanceof MovedOn)) {
            continue;
        }

        const installed: InstalledClientExtension[] = [];
        const failures: Record<string, string> = {};

        extensions.forEach((info, i) => {
            const outcome = settled[i];

            if (outcome?.status === 'fulfilled') {
                installed.push({
                    manifest: info.manifest,
                    base: outcome.value.base,
                    enabled: info.enabled,
                    hasClient: info.hasClient === true,
                    hasIcon: outcome.value.hasIcon,
                    dev: info.devFolder !== undefined
                });
            } else if (outcome !== undefined) {
                failures[info.manifest.id] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            }
        });

        return { installed, failures };
    }
}

/* What the machine in front has, for a client with no shell to keep files. */
export async function machineExtensions(link: Link, endpointId: string): Promise<MachineExtensions> {
    if (!machineAnswers(link.connection, 'extension.clientFiles')) {
        return { installed: [], failures: {} };
    }

    await workerReady();

    const root = `${EXTENSION_FILES_PATH}${encodeURIComponent(endpointId)}/`;
    const answer = await read(link, root);
    const bases = answer.installed.map((entry) => entry.base);

    holdVersions(bases);
    // An extension whose files did not come keeps what it had, which this window may still run.
    await dropOtherVersions(root, [...bases, ...Object.keys(answer.failures).map((id) => `${root}${id}/`)]);

    return answer;
}
