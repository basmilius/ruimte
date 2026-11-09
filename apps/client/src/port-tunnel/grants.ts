import type { PortGrant } from '@ruimte/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

interface GrantStore {
    /* Keyed by endpoint; undefined until the machine answered, which is not the same as nothing shared. */
    byEndpoint: Record<string, readonly PortGrant[] | undefined>;
    set(endpointId: string, grants: readonly PortGrant[]): void;
    forget(endpointId: string): void;
}

export const usePortGrants = create<GrantStore>((set) => ({
    byEndpoint: {},
    set: (endpointId, grants) => set((state) => ({ byEndpoint: { ...state.byEndpoint, [endpointId]: grants } })),
    forget: (endpointId) =>
        set((state) => {
            const next = { ...state.byEndpoint };

            delete next[endpointId];

            return { byEndpoint: next };
        })
}));

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/* The port a page asks for when its address is one of the loopback spellings over http, else null. */
export function loopbackPort(url: string): number | null {
    const parsed = URL.parse(url);

    if (
        parsed === null ||
        parsed.protocol !== 'http:' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
        return null;
    }

    return parsed.port === '' ? 80 : Number(parsed.port);
}

/* The grant of this project that covers the address, or null. Another project's grant is never used for it. */
export function grantForUrl(grants: readonly PortGrant[] | undefined, url: string, projectId: string | null): PortGrant | null {
    const port = loopbackPort(url);

    if (port === null || projectId === null) {
        return null;
    }

    return grants?.find((grant) => grant.port === port && grant.projectId === projectId) ?? null;
}

export function currentProjectId(): string | null {
    return useProject.getState().current?.projectId ?? null;
}

/* Reads the grants again; a machine that cannot list them has none to use. */
export function loadPortGrants(endpointId: string): void {
    const transport = transportFor(endpointId);

    if (transport === null || !machineAnswers(transport.connection, 'port.list')) {
        usePortGrants.getState().forget(endpointId);

        return;
    }

    void fireAndForget(
        'port.list',
        transport.request('port.list', {}).then(({ grants }) => usePortGrants.getState().set(endpointId, grants))
    );
}

/*
 * Keeps the grants of a machine current while something shows a browser node of it: they load when the link
 * opens and again whenever the machine says they changed. This opens no link; a node of the machine already holds one.
 */
export function usePortGrantWatch(endpointId: string): void {
    const status = useEndpointConnection(endpointId).status;
    const features = useEndpointConnection(endpointId).features;

    useEffect(() => {
        if (status !== 'open' || !features?.includes('port.list')) {
            return;
        }

        loadPortGrants(endpointId);

        return transportFor(endpointId)?.on('port.changed', () => loadPortGrants(endpointId));
    }, [status, features, endpointId]);
}
