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
            useServers.getState().setEndpoint(settled, { label: info.label, reachability: info.reachability });
            const hello = await link.request('server.hello', {});
            useServers.getState().setInfo(settled, { platform: hello.platform, home: hello.home, version: hello.version });
        })
        .catch(() => undefined);
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
