import i18next from 'i18next';
import { AuthChallengeResultSchema, AuthTicketResultSchema, clientAuthMessage, daemonChallengeMessage } from '@ruimte/contracts';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { clientKey, type ClientKey } from './client-key';
import { forgetTicket, rememberLocalSecret, rememberTicket } from './credentials';

const post = async (httpBaseUrl: string, path: string, body: unknown): Promise<unknown | null> => {
    const response = await fetch(`${httpBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.ok ? await response.json() : null;
};

/*
 * Return null when legacy peers cannot use key authentication, allowing token fallback. A pinned-key
 * mismatch throws because connecting would defeat the pin.
 */
export const signIn = async (endpoint: Endpoint, key: ClientKey): Promise<string | null> => {
    const pinned = endpoint.daemonPublicKey;
    if (pinned === null) {
        return null;
    }
    const answer = await post(endpoint.httpBaseUrl, '/auth/challenge', {}).catch(() => null);
    const challenge = AuthChallengeResultSchema.safeParse(answer);
    if (!challenge.success) {
        return null;
    }
    const { daemon } = challenge.data;
    const identical = daemon.publicKey === pinned && (endpoint.daemonId === null || endpoint.daemonId === daemon.id);
    if (!identical || !(await verifySignature(pinned, daemonChallengeMessage(daemon.id, challenge.data.challenge), daemon.signature))) {
        reportImposter(endpoint);
        throw new Error(i18next.t('machines:handshake.wrongKey', { address: endpoint.httpBaseUrl }));
    }
    // Signed against the pinned id, never the one that just answered, so a stranger cannot pick what gets signed.
    const signature = await key.sign(clientAuthMessage(endpoint.daemonId ?? daemon.id, challenge.data.challenge, key.publicKey));
    const ticket = AuthTicketResultSchema.safeParse(
        await post(endpoint.httpBaseUrl, '/auth/ticket', { publicKey: key.publicKey, challenge: challenge.data.challenge, signature }).catch(() => null)
    );
    if (!ticket.success) {
        // The daemon does the handshake and still said no, so this client's key is not one it knows any more.
        forgetTicket(endpoint.id);
        reportUnknownKey(endpoint);
        return null;
    }
    rememberTicket(endpoint.id, ticket.data.ticket);
    // The ticket works, so the token that used to sit in every URL has done its last job.
    if (endpoint.token !== null) {
        useEndpoints.getState().clearToken(endpoint.id);
    }
    return ticket.data.ticket;
};

const reportUnknownKey = (endpoint: Endpoint): void => {
    useToasts.getState().show({
        id: `endpoint-key-${endpoint.id}`,
        kind: 'error',
        title: i18next.t('machines:handshake.unknownKey.title', { label: endpoint.label }),
        description: i18next.t('machines:handshake.unknownKey.description')
    });
};

const reportImposter = (endpoint: Endpoint): void => {
    useToasts.getState().show({
        id: `endpoint-key-${endpoint.id}`,
        kind: 'error',
        title: i18next.t('machines:handshake.imposter.title', { label: endpoint.label }),
        description: i18next.t('machines:handshake.imposter.description', { address: endpoint.httpBaseUrl })
    });
};

/*
 * The address a socket for this machine opens on, credential and all. This runs before every
 * connection and every reconnect, because the ticket it signs for is good for that connection only,
 * so nothing that lives longer than a connection ends up in a URL, a log or a process list.
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
    }
    const key = endpoint.daemonPublicKey === null ? null : await clientKey();
    if (key) {
        await signIn(endpoint, key);
    }
    // Read again, since signing in remembers a ticket and may have dropped the token; the row says which to send.
    return socketUrlFor(useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId) ?? endpoint);
};
