import { CodedError } from '@adecore/agents';
import { PORT_CHUNK_BYTES } from '@ruimte/contracts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { PortGrants } from '../ports/port-grants.ts';
import type { PortStreams } from '../ports/port-streams.ts';

/* A refusal of the ports as a request error, with the code and sentence the client shows. */
async function refusing<T>(work: () => T | Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (e) {
        if (e instanceof CodedError && !(e instanceof RequestError)) {
            throw new RequestError(e.code, e.message);
        }

        throw e;
    }
}

/*
 * Shared development ports. Any client of the account reads the grants and opens streams to them; only the local
 * secret shares or revokes (an agent shares through its own tool, while the machine allows it). None of these is
 * on a peer's list, so another machine gets nothing here.
 */
export function registerPortHandlers(dispatcher: Dispatcher, grants: PortGrants, streams: PortStreams): void {
    dispatcher.register('port.list', () => ({ grants: grants.list() }));
    dispatcher.register(
        'port.share',
        ({ projectId, port, host }) => refusing(() => ({ grant: grants.share(projectId, port, host ?? '127.0.0.1', 'person') })),
        { owner: true }
    );
    dispatcher.register(
        'port.revoke',
        ({ id }) => {
            if (!grants.revoke(id)) {
                throw new RequestError('unknown-grant', 'That port is not shared');
            }

            return {};
        },
        { owner: true }
    );

    dispatcher.register('port.open', ({ streamId, grantId }, client) => refusing(() => streams.open(client, streamId, grantId)));
    dispatcher.register('port.write', ({ streamId, offset, data }, client) =>
        refusing(() => {
            const bytes = new Uint8Array(Buffer.from(data, 'base64'));

            if (bytes.byteLength === 0 || bytes.byteLength > PORT_CHUNK_BYTES) {
                throw new RequestError('bad-request', 'A write carries between one byte and one chunk');
            }

            return streams.write(client, streamId, offset, bytes);
        })
    );
    dispatcher.register('port.credit', ({ streamId, offset }, client) =>
        refusing(() => {
            streams.credit(client, streamId, offset);

            return {};
        })
    );
    dispatcher.register('port.close', ({ streamId, half }, client) =>
        refusing(() => {
            streams.close(client, streamId, half);

            return {};
        })
    );
}
