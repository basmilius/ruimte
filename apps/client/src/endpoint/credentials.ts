/*
 * A ticket comes out of the handshake and rotates on every connection; it lives in memory only,
 * because writing it down is the thing this replaces. The session token underneath it is what a
 * client paired with before there were key pairs still carries, dropped as soon as a ticket proves
 * it is not needed.
 */
const tickets = new Map<string, string>();

export const rememberTicket = (endpointId: string, ticket: string): void => {
    tickets.set(endpointId, ticket);
};

export const forgetTicket = (endpointId: string): void => {
    tickets.delete(endpointId);
};

/* The row moved onto the id its daemon answers with; the ticket is for that same daemon. */
export const rekeyTicket = (oldId: string, newId: string): void => {
    const ticket = tickets.get(oldId);
    if (ticket === undefined || oldId === newId) {
        return;
    }
    tickets.delete(oldId);
    tickets.set(newId, ticket);
};

/*
 * The local secret the desktop shell read from the daemon's home, for the row of the daemon that
 * served this page. It lives in memory only, like a ticket, and is asked for again on every connection.
 * It never goes in a URL: it is traded for a ticket over a header, or proved on a direct channel.
 */
const localSecrets = new Map<string, string>();

export const rememberLocalSecret = (endpointId: string, secret: string | null): void => {
    if (secret === null) {
        localSecrets.delete(endpointId);
        return;
    }
    localSecrets.set(endpointId, secret);
};

/* The local secret this client holds for a row, which a direct connection proves it has without sending it. */
export const localSecretOf = (endpointId: string): string | null => localSecrets.get(endpointId) ?? null;

/*
 * The local secret of a row whose daemon predates trading it for a ticket, which takes nothing else
 * in a URL. Only ever set for such a daemon; any newer one gets a ticket in the secret's place.
 */
const secretsForUrls = new Map<string, string>();

export const rememberSecretForUrls = (endpointId: string, secret: string | null): void => {
    if (secret === null) {
        secretsForUrls.delete(endpointId);
        return;
    }
    secretsForUrls.set(endpointId, secret);
};

/*
 * What goes in the `token` query of a socket URL or of a URL an `<img>` fetches. The name stayed
 * because the daemon takes a ticket and a session token in the same place, which is what keeps a
 * client of either kind talking to a daemon of either kind.
 */
export const credentialFor = (endpoint: { id: string; token: string | null }): string | null =>
    tickets.get(endpoint.id) ?? endpoint.token ?? secretsForUrls.get(endpoint.id) ?? null;
