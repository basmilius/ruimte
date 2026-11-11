import type { ReadRequestMap, RequestType } from '@ruimte/contracts';
import { TransportError, type Transport } from '@/transport';
import { machineAnswers } from '@/transport/features';

/*
 * A request of the extension API, which no machine of 0.18.0 answers. It goes only to a machine that names it, so an
 * older one is never asked what it cannot answer: the request fails here with `unavailable`, which a call of the API
 * answers as its Result.
 */
export function extensionRequest<Type extends RequestType>(
    link: Pick<Transport, 'request' | 'connection'>,
    type: Type,
    payload: ReadRequestMap[Type]['payload']
): Promise<ReadRequestMap[Type]['result']> {
    if (!machineAnswers(link.connection, type)) {
        return Promise.reject(new TransportError('unavailable', `This machine does not answer ${type}`, { request: type }));
    }

    return link.request(type, payload);
}
