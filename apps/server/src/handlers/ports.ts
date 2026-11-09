import { CodedError } from '@adecore/agents';
import { PORT_CHUNK_BYTES } from '@ruimte/contracts';
import type { Area, EventSource } from '../area.ts';
import type { PortGrants } from '../ports/port-grants.ts';
import type { PortStreams } from '../ports/port-streams.ts';

export interface PortsDeps {
    grants: PortGrants;
    streams: PortStreams;
    /* What every client hears: the list of shared ports moved. */
    changes: EventSource;
}

/*
 * Shared development ports. Any client of the account reads the grants and opens streams to them; only the local
 * secret shares or revokes (an agent shares through its own tool, while the machine allows it). None of these is
 * on a peer's list, so another machine gets nothing here. The streams a client opened end with its channel.
 */
export function portsArea({ grants, streams, changes }: PortsDeps): Area {
    return {
        name: 'port',
        sources: [changes],
        holders: [{ detachAll: (clientId) => streams.channelClosed(clientId) }],
        handlers: (dispatcher) => {
            dispatcher.register('port.list', () => ({ grants: grants.list() }));
            dispatcher.register('port.share', ({ projectId, port, host }) => ({ grant: grants.share(projectId, port, host ?? '127.0.0.1', 'person') }), {
                owner: true
            });
            dispatcher.register(
                'port.revoke',
                ({ id }) => {
                    if (!grants.revoke(id)) {
                        throw new CodedError('unknown-grant', 'That port is not shared');
                    }

                    return {};
                },
                { owner: true }
            );

            dispatcher.register('port.open', ({ streamId, grantId }, client) => streams.open(client, streamId, grantId));
            dispatcher.register('port.write', ({ streamId, offset, data }, client) => {
                const bytes = new Uint8Array(Buffer.from(data, 'base64'));

                if (bytes.byteLength === 0 || bytes.byteLength > PORT_CHUNK_BYTES) {
                    throw new CodedError('bad-request', 'A write carries between one byte and one chunk');
                }

                return streams.write(client, streamId, offset, bytes);
            });
            dispatcher.register('port.credit', ({ streamId, offset }, client) => {
                streams.credit(client, streamId, offset);

                return {};
            });
            dispatcher.register('port.close', ({ streamId, half }, client) => {
                streams.close(client, streamId, half);

                return {};
            });
        }
    };
}
