import i18next from 'i18next';
import { AuthTicketResultSchema } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { forgetTicket, rememberLocalSecret, rememberSecretForUrls, rememberTicket } from './credentials';

/*
 * Trades the local secret for a ticket over the Authorization header, so the secret never sits in a
 * URL. A daemon from before the trade answers with its app shell or a 404; that one is sent the
 * secret in the URL as before. A refusal or a daemon that does not answer leaves the last ticket.
 */
export const tradeLocalSecret = async (endpoint: Endpoint, secret: string): Promise<void> => {
    const response = await fetch(`${endpoint.httpBaseUrl}/auth/local-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    }).catch(() => null);
    if (response === null || (!response.ok && response.status !== 404)) {
        return;
    }
    const ticket = AuthTicketResultSchema.safeParse(response.ok ? await response.json().catch(() => null) : null);
    if (ticket.success) {
        rememberTicket(endpoint.id, ticket.data.ticket);
        rememberSecretForUrls(endpoint.id, null);
        return;
    }
    forgetTicket(endpoint.id);
    rememberSecretForUrls(endpoint.id, secret);
};

/*
 * The address a socket for this machine opens on, credential and all. Runs before every connection
 * and every reconnect, because a ticket opens one socket only. The URL carries a ticket and not the
 * local secret (except for a daemon from before the trade), so a leaked address gives away bytes
 * while that ticket lives, and never a second socket. Only the row of this machine has an address of
 * its own; every other machine is reached through a route.
 */
export const socketAddressFor = async (endpointId: string): Promise<string> => {
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
};
