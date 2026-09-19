import i18next from 'i18next';
import { useEffect, useState } from 'react';
import type { ByteResource } from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';
import { activeEndpoint, endpointById, useEndpoints } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { BlobCache, type BlobLease, type BlobState } from './blob-cache';
import { readResource } from './byte-transfer';
import { useEndpointConnection } from './status';

/*
 * Bytes a machine serves that something on screen draws, with what pins one version of them: an
 * attachment id never changes, a project icon has a version, and a file has its mtime and size.
 */
export type MachineResource =
    | { kind: 'attachment'; chatId: string; attachmentId: string }
    | { kind: 'projectIcon'; projectId: string; theme: 'light' | 'dark'; version: string }
    | { kind: 'file'; path: string; mtime: number; size: number };

export type MachineUrl = BlobState;

// Enough for a chat full of screenshots to scroll back without a refetch; what is on screen does not count.
const IDLE_BYTES = 64 * 1024 * 1024;

const cache = new BlobCache({ maxIdleBytes: IDLE_BYTES });

const NOTHING: MachineUrl = { url: null, failure: null };

/*
 * The HTTP route for the bytes, with the machine's credential in the URL the way the socket carries it,
 * since an `<img>` cannot send a header. The version is in the URL too, which is what lets the browser
 * keep the answer for good. The machine is the one the thing on screen belongs to, never simply the
 * active one: a second workspace or a list that spans machines would otherwise ask the wrong daemon.
 */
export const httpUrlFor = (endpointId: string, resource: MachineResource): string => {
    const endpoint = endpointById(endpointId) ?? activeEndpoint();
    const credential = credentialFor(endpoint);
    if (resource.kind === 'attachment') {
        const query = credential ? `?token=${encodeURIComponent(credential)}` : '';
        return `${endpoint.httpBaseUrl}/attachments/${encodeURIComponent(resource.chatId)}/${encodeURIComponent(resource.attachmentId)}${query}`;
    }
    const query =
        resource.kind === 'projectIcon'
            ? new URLSearchParams({ v: resource.version, theme: resource.theme })
            : new URLSearchParams({ path: resource.path, v: `${resource.mtime}-${resource.size}` });
    if (credential) {
        query.set('token', credential);
    }
    if (resource.kind === 'projectIcon') {
        return `${endpoint.httpBaseUrl}/projects/${encodeURIComponent(resource.projectId)}/icon?${query.toString()}`;
    }
    return `${endpoint.httpBaseUrl}/fs/file?${query.toString()}`;
};

const wireResourceOf = (resource: MachineResource): ByteResource => {
    if (resource.kind === 'attachment') {
        return { kind: 'attachment', chatId: resource.chatId, attachmentId: resource.attachmentId };
    }
    if (resource.kind === 'projectIcon') {
        return { kind: 'projectIcon', projectId: resource.projectId, theme: resource.theme };
    }
    return { kind: 'file', path: resource.path };
};

export const machineResourceKey = (endpointId: string, resource: MachineResource): string => {
    if (resource.kind === 'attachment') {
        return JSON.stringify([endpointId, resource.kind, resource.chatId, resource.attachmentId]);
    }
    if (resource.kind === 'projectIcon') {
        return JSON.stringify([endpointId, resource.kind, resource.projectId, resource.theme, resource.version]);
    }
    return JSON.stringify([endpointId, resource.kind, resource.path, resource.mtime, resource.size]);
};

/*
 * The one way something on screen turns bytes on a machine into a URL. Over a socket that is the HTTP
 * route. Over a direct connection there is no HTTP to count on, even where the address happens to
 * answer, because across two networks it will not: the bytes come over the channel and the URL is a
 * blob URL from a cache shared by everything on screen. A load that failed is tried again when the
 * connection opens, since the usual reason is that it was not open.
 */
export const useMachineUrl = (resource: MachineResource | null, endpointId?: string): MachineUrl => {
    const activeId = useEndpoints((s) => s.activeId);
    const machineId = endpointId ?? activeId;
    const direct = useEndpoints((s) => s.endpoints.find((entry) => entry.id === machineId)?.direct === true);
    const open = useEndpointConnection(machineId).status === 'open';
    const key = resource === null ? null : machineResourceKey(machineId, resource);
    // What the request asks for, as a string: a stable dependency where `resource` is a new object on every render.
    const wire = resource === null ? null : JSON.stringify(wireResourceOf(resource));
    const [held, setHeld] = useState<{ key: string; lease: BlobLease; state: MachineUrl } | null>(null);

    useEffect(() => {
        if (!direct || key === null || wire === null) {
            return;
        }
        const payload = JSON.parse(wire) as ByteResource;
        const lease = cache.acquire(key, () => {
            const transport = transportFor(machineId);
            if (!transport) {
                return Promise.reject(new Error(i18next.t('machines:connection.unknownMachine')));
            }
            return readResource((piece) => transport.request('bytes.read', piece), payload);
        });
        const update = (): void => setHeld({ key, lease, state: lease.current() });
        update();
        const unsubscribe = lease.subscribe(update);
        return () => {
            unsubscribe();
            lease.release();
            setHeld((current) => (current?.lease === lease ? null : current));
        };
    }, [direct, key, wire, machineId]);

    const lease = held !== null && held.key === key ? held.lease : null;
    useEffect(() => {
        if (open) {
            lease?.retry();
        }
    }, [open, lease]);

    if (resource === null) {
        return NOTHING;
    }
    if (!direct) {
        return { url: httpUrlFor(machineId, resource), failure: null };
    }
    return held !== null && held.key === key ? held.state : NOTHING;
};
