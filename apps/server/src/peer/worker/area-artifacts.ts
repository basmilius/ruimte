import { CodedError } from '@adecore/agents';
import type { Area } from '../../area.ts';
import type { Artifacts } from '../../artifacts/artifacts.ts';
import { type Dispatcher } from '../../dispatcher.ts';
import type { PeerLinks } from '../../projects/peer-links.ts';
import type { ClientConnection } from '../../wire.ts';
import { requirePeerLinks } from './peer-access.ts';

interface PeerArtifactsDeps {
    links: Pick<PeerLinks, 'list' | 'linkOf'>;
    artifacts: Artifacts;
}

/*
 * The Output another machine may read here, for a copy a person there asked for: only the project its
 * link names, read only. Each request starts with `requirePeerLinks`, and a project the link does not
 * name answers as if that machine had no link at all.
 */
export function peerArtifactsArea(deps: PeerArtifactsDeps): Area {
    return { name: 'peer artifacts', handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { links, artifacts }: PeerArtifactsDeps): void {
    const linkedProject = (client: ClientConnection, projectId: string): string => {
        if (links.linkOf(requirePeerLinks(client, links), projectId) === null) {
            throw new CodedError('peer-not-linked', 'That project here is not linked to this machine');
        }
        return projectId;
    };

    dispatcher.register(
        'peer.artifactList',
        async ({ projectId }, client) => ({ artifacts: await artifacts.list({ projectId: linkedProject(client, projectId) }) }),
        { peer: true }
    );

    dispatcher.register('peer.artifactGet', ({ projectId, artifactId }, client) => artifacts.getIn(linkedProject(client, projectId), artifactId), {
        peer: true
    });

    dispatcher.register('peer.artifactRead', ({ projectId, ...query }, client) => artifacts.readPiece(linkedProject(client, projectId), query), {
        peer: true
    });
}
