import { knownNodeSizes, type EndpointInfo, type EndpointNameSource } from '@ruimte/contracts';
import { noteDaemonIdentity } from '@/endpoint/identity';
import { LOCAL_ENDPOINT_ID, localMachineLabel, useEndpoints } from '@/state/endpoints';
import { serverInfoOf, useServers } from '@/state/server';
import { useProvidersStore } from '@adecore/agents-react/state';
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
            adoptEndpointInfo(settled, info);
            void link
                .request('provider.list', {})
                .then(({ providers }) => useProvidersStore.getState().setProviders(settled, providers))
                .catch(() => undefined);
            const hello = await link.request('server.hello', {});
            useServers.getState().setInfo(settled, { platform: hello.platform, home: hello.home, version: hello.version, model: hello.model ?? null });
            // The model arrives a request later than the name, so the row asks again now that it is known.
            adoptMachineName(settled, info.label, info.nameSource ?? 'default');
        })
        .catch(() => undefined);
}

/* Everything a machine says about itself, on every connection and in its answer to a change made here. */
export function adoptEndpointInfo(endpointId: string, info: EndpointInfo): void {
    useEndpoints.getState().learnBrokerUrl(endpointId, info.brokerUrl ?? null);
    useEndpoints.getState().learnLan(endpointId, info.lan ?? null);
    useServers.getState().setEndpoint(endpointId, {
        label: info.label,
        nameSource: info.nameSource ?? 'default',
        icon: info.icon ?? null,
        agentsDeleteAnyView: info.agentsDeleteAnyView === true,
        reachOpenProjects: info.reachOpenProjects === true,
        streamingAllowed: info.streamingAllowed ?? true,
        resumeAtReset: info.resumeAtReset === true,
        visualReplies: info.visualReplies ?? true,
        appleFoundationEnabled: info.appleFoundationEnabled === true,
        keepAwake: info.keepAwake ?? 'off',
        keepAwakeOnBattery: info.keepAwakeOnBattery === true,
        keepAwakeDisplay: info.keepAwakeDisplay === true,
        keepAwakeAvailable: info.keepAwakeAvailable === true,
        keepAwakeLidClosed: info.keepAwakeLidClosed === true,
        keepAwakeLidAvailable: info.keepAwakeLidAvailable === true,
        keepAwakeLidRule: info.keepAwakeLidRule === true,
        update: info.update ?? null,
        broker: info.broker ?? { mode: 'default' },
        brokerFixed: info.brokerFixed === true,
        lanDoor: info.lanDoor ?? true,
        lanDoorFixed: info.lanDoorFixed === true,
        agentIntegrations: info.agentIntegrations ?? null,
        reachability: info.reachability,
        publicKey: info.publicKey ?? null,
        accountId: info.accountId,
        worktreeRoot: info.worktreeRoot,
        nodeSizes: knownNodeSizes(info.nodeSizes),
        usageStats: info.usageStats,
        viewReferences: info.viewReferences === true
    });
    adoptMachineName(endpointId, info.label, info.nameSource ?? 'default');
}

/*
 * A name a person gave a machine becomes the row's label. A default name is a hostname, which the
 * row's own label reads better than; clearing the name lands here too, so the local row is written back.
 */
export function adoptMachineName(endpointId: string, label: string, nameSource: EndpointNameSource): void {
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
