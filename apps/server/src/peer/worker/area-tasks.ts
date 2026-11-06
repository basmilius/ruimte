import type { Area } from '../../area.ts';
import type { Dispatcher } from '../../dispatcher.ts';
import type { PeerLinks } from '../../projects/peer-links.ts';
import type { ClientConnection } from '../../wire.ts';
import { requirePeerLinks } from './peer-access.ts';
import type { PeerTasks } from './peer-tasks.ts';

export interface PeerTasksDeps {
    links: Pick<PeerLinks, 'list'>;
    tasks: PeerTasks;
}

/*
 * What a machine that works here may ask. Each request starts with `requirePeerLinks`, because being
 * let in grants nothing: without a link a person made here the answer is `peer-not-linked`.
 */
export function peerTasksArea(deps: PeerTasksDeps): Area {
    return {
        name: 'peer tasks',
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        closed: (clientId, access) => {
            if (access.peer !== undefined) {
                deps.tasks.channelClosed(clientId);
            }
        }
    };
}

function registerRequests(dispatcher: Dispatcher, { links, tasks }: PeerTasksDeps): void {
    const machineOf = (client: ClientConnection): string => requirePeerLinks(client, links);

    dispatcher.register('peer.taskStart', (payload, client) => tasks.start(machineOf(client), client.id, payload), {
        peer: true,
        count: ['peers.tasks']
    });

    dispatcher.register(
        'peer.taskStop',
        async (payload, client) => {
            await tasks.stop(machineOf(client), payload.nodeId);
            return {};
        },
        { peer: true }
    );

    dispatcher.register('peer.result', (payload, client) => tasks.result(machineOf(client), client.id, payload), { peer: true });

    dispatcher.register('peer.bundlePut', async (payload, client) => ({ received: await tasks.bundlePut(machineOf(client), client.id, payload) }), {
        peer: true
    });

    dispatcher.register('peer.bundleRead', (payload, client) => tasks.bundleRead(machineOf(client), payload), { peer: true });

    dispatcher.register(
        'peer.close',
        (payload, client) => {
            machineOf(client);
            tasks.close(client.id, payload.projectId);
            return {};
        },
        { peer: true }
    );
}
