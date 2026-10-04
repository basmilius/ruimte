import { useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { watchPool } from '@/transport/pool-watch';
import { adoptMachineName } from '@/transport/server-info';

// Follow the pool's live sockets so machine identity changes propagate across clients without polling.
export function startEndpointWatch(): () => void {
    return watchPool((link, endpointId) => ({
        subscriptions: [
            link.on('endpoint.changed', (payload) => {
                useServers.getState().setIdentity(endpointId, {
                    label: payload.label,
                    nameSource: payload.nameSource,
                    icon: payload.icon,
                    agentsDeleteAnyView: payload.agentsDeleteAnyView === true,
                    ...(payload.streamingAllowed === undefined ? {} : { streamingAllowed: payload.streamingAllowed }),
                    resumeAtReset: payload.resumeAtReset === true,
                    ...(payload.keepAwake === undefined
                        ? {}
                        : {
                              keepAwake: payload.keepAwake,
                              keepAwakeOnBattery: payload.keepAwakeOnBattery === true,
                              keepAwakeDisplay: payload.keepAwakeDisplay === true,
                              keepAwakeLidClosed: payload.keepAwakeLidClosed === true
                          }),
                    ...(payload.keepAwakeLidRule === undefined ? {} : { keepAwakeLidRule: payload.keepAwakeLidRule }),
                    ...(payload.broker === undefined ? {} : { broker: payload.broker, brokerFixed: payload.brokerFixed === true }),
                    ...(payload.lanDoor === undefined ? {} : { lanDoor: payload.lanDoor, lanDoorFixed: payload.lanDoorFixed === true })
                });
                // A daemon from before the broker setting sends no URL, which says nothing about its broker; the same for the door.
                if (payload.brokerUrl !== undefined) {
                    useEndpoints.getState().learnBrokerUrl(endpointId, payload.brokerUrl);
                }
                if (payload.lan !== undefined) {
                    useEndpoints.getState().learnLan(endpointId, payload.lan);
                }
                adoptMachineName(endpointId, payload.label, payload.nameSource);
            }),
            link.on('endpoint.updateChanged', ({ update }) => useServers.getState().setUpdate(endpointId, update))
        ]
    }));
}
