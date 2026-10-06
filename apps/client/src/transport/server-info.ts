import type { EndpointNameSource } from '@ruimte/contracts';
import { noteDaemonIdentity } from '@/endpoint/identity';
import { LOCAL_ENDPOINT_ID, localMachineLabel, useEndpoints } from '@/state/endpoints';
import { serverInfoOf, useServers } from '@/state/server';
import { useProvidersStore } from '@adecore/agents-react/state/providers';
import { pool, transportFor } from '@/transport';
import { watchOpenMachines } from './open-machines';

/*
 * Who the daemon is comes first and the rest waits for it. A row that was keyed on an address moves
 * onto the daemon's own id here, and every store keyed on the endpoint would otherwise fill under
 * the id that row is about to leave.
 */
function load(endpointId: string): void {
    const link = transportFor(endpointId);
    if (!link) {
        return;
    }
    void link
        .request('endpoint.info', {})
        .then(async (info) => {
            const settled = noteDaemonIdentity(endpointId, info);
            useEndpoints.getState().learnBrokerUrl(settled, info.brokerUrl ?? null);
            useEndpoints.getState().learnLan(settled, info.lan ?? null);
            useServers.getState().setEndpoint(settled, {
                label: info.label,
                nameSource: info.nameSource ?? null,
                icon: info.icon ?? null,
                agentsDeleteAnyView: info.agentsDeleteAnyView === true,
                streamingAllowed: info.streamingAllowed ?? null,
                resumeAtReset: info.resumeAtReset === true,
                appleFoundationEnabled: info.appleFoundationEnabled ?? null,
                keepAwake: info.keepAwake ?? null,
                keepAwakeOnBattery: info.keepAwakeOnBattery === true,
                keepAwakeDisplay: info.keepAwakeDisplay === true,
                keepAwakeAvailable: info.keepAwakeAvailable === true,
                keepAwakeLidClosed: info.keepAwakeLidClosed === true,
                keepAwakeLidAvailable: info.keepAwakeLidAvailable === true,
                keepAwakeLidRule: info.keepAwakeLidRule === true,
                update: info.update ?? null,
                broker: info.broker ?? null,
                brokerFixed: info.brokerFixed === true,
                lanDoor: info.lanDoor ?? null,
                lanDoorFixed: info.lanDoorFixed === true,
                reachability: info.reachability,
                publicKey: info.publicKey ?? null,
                accountId: info.accountId
            });
            void link
                .request('provider.list', {})
                .then(({ providers }) => useProvidersStore.getState().setProviders(settled, providers))
                .catch(() => undefined);
            adoptMachineName(settled, info.label, info.nameSource ?? null);
            const hello = await link.request('server.hello', {});
            useServers.getState().setInfo(settled, { platform: hello.platform, home: hello.home, version: hello.version, model: hello.model ?? null });
            // The model arrives a request later than the name, so the row asks again now that it is known.
            adoptMachineName(settled, info.label, info.nameSource ?? null);
        })
        .catch(() => undefined);
}

/*
 * A name a person gave a machine is the machine's own, so the endpoint row this client keeps takes
 * it and every list stops saying two things at once. A default name is a hostname, which the row's
 * own label ("This MacBook Pro", or the name the account lists) reads better than. Clearing the name
 * lands here too, which is why the row for this machine is written back rather than left alone.
 */
export function adoptMachineName(endpointId: string, label: string, nameSource: EndpointNameSource | null): void {
    if (nameSource === 'chosen') {
        useEndpoints.getState().setLabel(endpointId, label);
        return;
    }
    if (endpointId === LOCAL_ENDPOINT_ID) {
        useEndpoints.getState().setLabel(endpointId, localMachineLabel(serverInfoOf(endpointId).model));
    }
}

/* Asks every machine who it is on every connection it opens and whenever it changed; the answer feeds labels, icons and the account record. */
export function startServerInfo(): () => void {
    return watchOpenMachines(
        {
            ids: () => pool.ids(),
            statusOf: (endpointId) => pool.statusOf(endpointId),
            subscribe: (handler) => pool.subscribe(handler),
            onChanged: (endpointId, handler) => pool.peek(endpointId)?.on('endpoint.changed', handler) ?? null
        },
        load
    );
}
