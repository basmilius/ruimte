import { AuthTicketResultSchema } from '@ruimte/contracts';
import i18next from 'i18next';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { rememberLocalSecret, rememberTicket } from '../transport-api/credentials';

/*
 * Trades the local secret for a ticket over the Authorization header, so the secret never sits in a
 * URL. A refusal, an answer that is no ticket or a daemon that does not answer leaves the last ticket.
 */
async function tradeLocalSecret(endpoint: Endpoint, secret: string): Promise<void> {
    const response = await fetch(`${endpoint.httpBaseUrl}/auth/local-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    }).catch(() => null);
    if (response === null || !response.ok) {
        return;
    }
    const ticket = AuthTicketResultSchema.safeParse(await response.json().catch(() => null));
    if (ticket.success) {
        rememberTicket(endpoint.id, ticket.data.ticket);
    }
}

/*
 * Runs before every connection and reconnect, because a ticket opens one socket only. The URL carries
 * a ticket and never the local secret, so a leaked address never opens a second socket.
 */
export async function socketAddressFor(endpointId: string): Promise<string> {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
        throw new Error(i18next.t('machines:handshake.noEndpoint', { id: endpointId }));
    }
    if (endpointId === LOCAL_ENDPOINT_ID) {
        // Asked again on every attempt, so a daemon that started after the window, or on a fresh home, is still reached.
        const secret = await desktop()
            ?.localSecret?.()
            .catch(() => null);
        rememberLocalSecret(endpointId, secret ?? null);
        if (secret) {
            await tradeLocalSecret(endpoint, secret);
        }
    }
    return socketUrlFor(endpoint);
}
