/*
 * A ticket comes out of the local secret's trade or a direct channel's verdict and rotates on every
 * connection; it lives in memory only, because writing it down would make it a session token.
 */
const tickets = new Map<string, string>();

export function rememberTicket(endpointId: string, ticket: string): void {
    tickets.set(endpointId, ticket);
}

export function forgetTicket(endpointId: string): void {
    tickets.delete(endpointId);
}

/* The row moved onto the id its daemon answers with; the ticket is for that same daemon. */
export function rekeyTicket(oldId: string, newId: string): void {
    const ticket = tickets.get(oldId);
    if (ticket === undefined || oldId === newId) {
        return;
    }
    tickets.delete(oldId);
    tickets.set(newId, ticket);
}

/*
 * The local secret the desktop shell read from the daemon's home, for the row of the daemon that
 * served this page. It lives in memory only, like a ticket, and is asked for again on every connection.
 * It is traded for a ticket over a header or proved on a direct channel; only a daemon from before
 * the trade gets it in a URL (`secretsForUrls`).
 */
const localSecrets = new Map<string, string>();

export function rememberLocalSecret(endpointId: string, secret: string | null): void {
    if (secret === null) {
        localSecrets.delete(endpointId);
        return;
    }
    localSecrets.set(endpointId, secret);
}

/* The local secret this client holds for a row, which a direct connection proves it has without sending it. */
export function localSecretOf(endpointId: string): string | null {
    return localSecrets.get(endpointId) ?? null;
}

/* The local secret of a daemon from before the ticket trade, which takes nothing else in a URL. A newer daemon gets a ticket instead. */
const secretsForUrls = new Map<string, string>();

export function rememberSecretForUrls(endpointId: string, secret: string | null): void {
    if (secret === null) {
        secretsForUrls.delete(endpointId);
        return;
    }
    secretsForUrls.set(endpointId, secret);
}

/* What goes in the `token` query of a socket URL or of a URL an `<img>` fetches, the name the daemon reads it under. */
export function credentialFor(endpoint: { id: string }): string | null {
    return tickets.get(endpoint.id) ?? secretsForUrls.get(endpoint.id) ?? null;
}
