import type { EndpointNameSource } from '@ruimte/contracts';
import { noteDaemonIdentity } from '@/endpoint/identity';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { transport, transportFor } from '@/transport';

/*
 * Who the daemon is comes first and the rest waits for it: a row that was keyed on an address moves
 * onto the daemon's own id here, and every store keyed on the endpoint would otherwise fill under
 * the id that row is about to leave.
 */
const load = (endpointId: string): void => {
    const link = transportFor(endpointId);
    if (!link) {
        return;
    }
    void link
        .request('endpoint.info', {})
        .then(async (info) => {
            const settled = noteDaemonIdentity(endpointId, info);
            useServers.getState().setEndpoint(settled, {
                label: info.label,
                nameSource: info.nameSource ?? null,
                icon: info.icon ?? null,
                reachability: info.reachability
            });
            adoptChosenName(settled, info.label, info.nameSource ?? null);
            const hello = await link.request('server.hello', {});
            useServers.getState().setInfo(settled, { platform: hello.platform, home: hello.home, version: hello.version });
        })
        .catch(() => undefined);
};

/*
 * A name a person gave a machine is the machine's own, so the endpoint row this client keeps takes
 * it and every list stops saying two things at once. A default name is a hostname, which the row's
 * own label ("This machine", or what the pairing put there) reads better than.
 */
export const adoptChosenName = (endpointId: string, label: string, nameSource: EndpointNameSource | null): void => {
    if (nameSource === 'chosen') {
        useEndpoints.getState().setLabel(endpointId, label);
    }
};

/* Asks the daemon who it is on every connection; the answer feeds platform-specific labels. */
export const startServerInfo = (): (() => void) => {
    const sync = (): void => {
        if (transport.status === 'open') {
            load(currentEndpointId());
        }
    };
    sync();
    const offStatus = transport.subscribeStatus((status) => {
        if (status === 'open') {
            sync();
        }
    });
    // Another machine whose socket was already open changes no status, so the switch itself has to ask.
    const offActive = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            sync();
        }
    });
    return () => {
        offStatus();
        offActive();
    };
};
