import { useServers } from '@/state/server';
import { pool } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';

/*
 * A machine's name and its icon belong to the machine, not to the client that typed them: the daemon
 * keeps both and tells every client that is connected. Watching each socket is what makes the
 * switcher and the Machines pane redraw when someone renames a machine from another client, without
 * anything here having to ask again.
 *
 * The set of sockets is the pool's, so the subscriptions follow it: a machine that is paired starts
 * being watched the moment it has a socket, and a forgotten one stops.
 */
export const startEndpointWatch = (): (() => void) => {
    const watching = new Map<string, () => void>();

    const sync = (): void => {
        const ids = new Set(pool.ids());
        for (const [endpointId, stop] of watching) {
            if (!ids.has(endpointId)) {
                stop();
                watching.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            const link = watching.has(endpointId) ? null : pool.peek(endpointId);
            if (!link) {
                continue;
            }
            watching.set(
                endpointId,
                link.on('endpoint.changed', (payload) => {
                    useServers.getState().setIdentity(endpointId, { label: payload.label, nameSource: payload.nameSource, icon: payload.icon });
                    adoptMachineName(endpointId, payload.label, payload.nameSource);
                })
            );
        }
    };

    sync();
    const off = pool.subscribe(sync);
    return () => {
        off();
        for (const stop of watching.values()) {
            stop();
        }
        watching.clear();
    };
};
