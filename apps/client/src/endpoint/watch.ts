import { useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { watchPool } from '@/transport/pool-watch';
import { adoptMachineName } from '@/transport/server-info';

// Follow the pool's live sockets so machine identity changes propagate across clients without polling.
export const startEndpointWatch = (): (() => void) =>
    watchPool((link, endpointId) => ({
        subscriptions: [
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
        ]
    }));
