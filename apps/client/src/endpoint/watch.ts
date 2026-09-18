import { useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { pool } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';

// Follow the pool's live sockets so machine identity changes propagate across clients without polling.
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
                    useServers.getState().setIdentity(endpointId, {
                        label: payload.label,
                        nameSource: payload.nameSource,
                        icon: payload.icon,
                        agentsDeleteAnyView: payload.agentsDeleteAnyView === true,
                        refuseStatements: payload.refuseStatements === true,
                        ...(payload.streamingAllowed === undefined ? {} : { streamingAllowed: payload.streamingAllowed }),
                        ...(payload.broker === undefined ? {} : { broker: payload.broker, brokerFixed: payload.brokerFixed === true })
                    });
                    // A daemon from before the broker setting sends no URL, which says nothing about its broker.
                    if (payload.brokerUrl !== undefined) {
                        useEndpoints.getState().learnBrokerUrl(endpointId, payload.brokerUrl);
                    }
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
