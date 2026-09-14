import { AuthChallengeResultSchema, AuthTicketResultSchema, clientAuthMessage, daemonChallengeMessage } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { clientKey, type ClientKey } from './client-key';
import { forgetTicket, rememberLocalSecret, rememberTicket } from './credentials';

/*
 * Verifying a daemon's signature needs no private key, so this side of ed25519 is enough of a
 * reason not to reach for a library: what a browser without it loses is the pinning, not the
 * connection, and the client falls back to the session token it already had.
 */
export const verifyDaemon = async (publicKey: string, message: string, signature: string): Promise<boolean> => {
    try {
        const key = await crypto.subtle.importKey('raw', bytesOf(publicKey), { name: 'Ed25519' }, false, ['verify']);
        return await crypto.subtle.verify({ name: 'Ed25519' }, key, bytesOf(signature), new TextEncoder().encode(message));
    } catch {
        return false;
    }
};

const bytesOf = (base64url: string): ArrayBuffer => {
    const binary = atob(base64url.replaceAll('-', '+').replaceAll('_', '/'));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
};

const post = async (httpBaseUrl: string, path: string, body: unknown): Promise<unknown | null> => {
    const response = await fetch(`${httpBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.ok ? await response.json() : null;
};

/*
 * Signs in with the daemon's own key pair and this client's, and answers with the ticket that comes
 * out. Null means "this connection cannot be made with a key", which is the honest answer for a
 * daemon from before the handshake existed and for a browser without ed25519; the caller then falls
 * back to whatever the row still holds. It throws only when the machine on the other end is not the
 * one this client pinned, because connecting anyway is the thing pinning exists to prevent.
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
    if (!identical || !(await verifyDaemon(pinned, daemonChallengeMessage(daemon.id, challenge.data.challenge), daemon.signature))) {
        reportImposter(endpoint);
        throw new Error(`${endpoint.httpBaseUrl} does not hold the key this client paired with`);
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
        title: `${endpoint.label} does not know this client`,
        description: 'Its access was revoked, or the machine lost the pairing. Pair again to connect.'
    });
};

const reportImposter = (endpoint: Endpoint): void => {
    useToasts.getState().show({
        id: `endpoint-key-${endpoint.id}`,
        kind: 'error',
        title: `${endpoint.label} cannot prove its identity`,
        description: `${endpoint.httpBaseUrl} answers with a different key than the one this client paired with. Pair again to connect.`
    });
};

/*
 * The address a socket for this machine opens on, credential and all. Run before every connection
 * and every reconnect: the ticket it signs for is good for that connection, so nothing that lives
 * longer than a connection ends up in a URL, a log or a process list.
 */
export const socketAddressFor = async (endpointId: string): Promise<string> => {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
        throw new Error(`No endpoint ${endpointId} to connect to`);
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
    // Read again: signing in remembers a ticket and may have dropped the token, and the row is what says which to send.
    return socketUrlFor(useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId) ?? endpoint);
};
