import type { RequestMap, RequestType } from '@ruimte/contracts';
import { machineAnswers } from '@/transport/features';
import { TransportError, type Transport } from '@/transport';

/*
 * A request of the extension API, which no machine of 0.18.0 answers. It goes only to a machine that names it, so an
 * older one is never asked what it cannot answer: the request fails here with `unavailable`, which a call of the API
 * answers as its Result.
 */
export function extensionRequest<Type extends RequestType>(
    link: Pick<Transport, 'request' | 'connection'>,
    type: Type,
    payload: RequestMap[Type]['payload']
): Promise<RequestMap[Type]['result']> {
    if (!machineAnswers(link.connection, type)) {
        return Promise.reject(new TransportError('unavailable', `This machine does not answer ${type}`, { request: type }));
    }

    return link.request(type, payload);
}
