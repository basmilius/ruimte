/*
 * The credential this client sends to a daemon right now, per machine. A ticket comes out of the
 * handshake and rotates on every connection; it lives in memory only, because writing it down is
 * the thing this replaces. The session token underneath it is what a client paired with before
 * there were key pairs still carries, and it is dropped as soon as a ticket proves it is not needed.
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
 */
const localSecrets = new Map<string, string>();

export const rememberLocalSecret = (endpointId: string, secret: string | null): void => {
    if (secret === null) {
        localSecrets.delete(endpointId);
        return;
    }
    localSecrets.set(endpointId, secret);
};

/*
 * What goes in the `token` query of a socket URL or of a URL an `<img>` fetches. The name stayed:
 * the daemon takes a ticket, a session token and the local secret in the same place, which is what keeps a client of
 * either kind talking to a daemon of either kind.
 */
export const credentialFor = (endpoint: { id: string; token: string | null }): string | null =>
    tickets.get(endpoint.id) ?? endpoint.token ?? localSecrets.get(endpoint.id) ?? null;
