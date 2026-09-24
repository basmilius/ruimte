import type { AuthTicketResult, Reachability } from '@ruimte/contracts';
import type { AuthStore } from './auth-store.ts';
import type { TicketGrant, TicketUse } from './handshake.ts';
import { sameSecret } from './local-secret.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export const isLoopbackAddress = (address: string): boolean => LOOPBACK.has(address) || address.startsWith('127.');

const isLoopbackHost = (host: string): boolean => LOOPBACK.has(host.replace(/^\[|\]$/g, '').replace(/:\d+$/, ''));

const isPrivateAddress = (address: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fd)/i.test(address.replace(/^::ffff:/, ''));

export const reachabilityOf = (address: string): Reachability => (isLoopbackAddress(address) ? 'loopback' : isPrivateAddress(address) ? 'lan' : 'public');

/*
 * A browser sends the page's origin with the upgrade; a page that is not ours must not drive
 * the daemon with the person's cookies-free but reachable socket. Our own origin, any loopback
 * origin (the desktop app, the dev server) and the configured extras pass; no header passes too,
 * since that is a non-browser client which has to hold a credential anyway.
 */
export const originAllowed = (origin: string | null, host: string | null, extra: string[]): boolean => {
    if (!origin) {
        return true;
    }
    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (isLoopbackHost(parsed.host)) {
        return true;
    }
    if (host && parsed.host === host) {
        return true;
    }
    return extra.some((allowed) => allowed === origin || allowed === parsed.host);
};

export interface Access {
    reachability: Reachability;
    // The paired session behind a ticket or a token, or null for a client that presented the local secret.
    sessionId: string | null;
}

// `ticket` is the ticket that got in, which a socket gives back when it closes.
type AccessDecision = { ok: true; access: Access; ticket?: string } | { ok: false; status: number; reason: string };

export interface AccessOptions {
    allowedOrigins: string[];
    // The secret in `$RUIMTE_HOME/local.key`, which is what a process on this machine presents.
    localSecret: string;
    // What turns a connection ticket back into a session; the handshake that handed it out.
    tickets: { ticketAccess(ticket: string, use: TicketUse): Promise<TicketGrant | null> };
}

/*
 * What a request is for, which decides the credentials it takes. A socket takes a ticket once, bytes
 * take one as often as it lives, and `local` takes the local secret itself and nothing that stands
 * in for it, since a ticket sits in URLs that get copied.
 */
export type AccessUse = TicketUse | 'local';

const bearerOf = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/*
 * Decides whether an upgrade or an API request may proceed and as whom. The source address never
 * grants anything: a tunnel or a reverse proxy makes every visitor loopback. It still decides
 * `reachability`, which only says how far away the client probably is.
 */
export const decideAccess = async (
    request: Request,
    remoteAddress: string,
    store: AuthStore,
    options: AccessOptions,
    use: AccessUse
): Promise<AccessDecision> => {
    if (!originAllowed(request.headers.get('origin'), request.headers.get('host'), options.allowedOrigins)) {
        return { ok: false, status: 403, reason: 'Origin not allowed' };
    }
    const reachability = reachabilityOf(remoteAddress);
    const token = bearerOf(request) || (new URL(request.url).searchParams.get('token') ?? '');
    if (!token) {
        return { ok: false, status: 401, reason: 'Pair this client first' };
    }
    if (sameSecret(token, options.localSecret)) {
        return { ok: true, access: { reachability, sessionId: null } };
    }
    if (use === 'local') {
        return { ok: false, status: 403, reason: 'Only the app on this machine may ask this' };
    }
    // A ticket first: it is what a client that signs for itself carries, and it costs no disk.
    const granted = await options.tickets.ticketAccess(token, use);
    if (granted) {
        return { ok: true, access: { reachability, sessionId: granted.sessionId }, ticket: token };
    }
    const sessionId = await store.authenticate(token);
    if (sessionId) {
        return { ok: true, access: { reachability, sessionId } };
    }
    return { ok: false, status: 401, reason: 'Unknown token' };
};

/*
 * Trades the local secret for a ticket, so the app on this machine puts that in its socket and byte
 * URLs rather than a secret that never expires and may mint pairing links. The secret is taken from
 * the Authorization header alone: a request that carries it in its URL has already leaked it.
 */
export const handleLocalTicketRequest = (request: Request, options: AccessOptions, tickets: { issueLocalTicket(): AuthTicketResult }): Response => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    if (!originAllowed(request.headers.get('origin'), request.headers.get('host'), options.allowedOrigins)) {
        return new Response('Origin not allowed', { status: 403 });
    }
    const secret = bearerOf(request);
    if (!secret || !sameSecret(secret, options.localSecret)) {
        return new Response('That is not the secret of this machine', { status: 401 });
    }
    return Response.json(tickets.issueLocalTicket());
};

/*
 * The one rule for minting a pairing link, over HTTP and over the socket alike: only a client that
 * presented the local secret may invite another machine. A paired client may not, or a single
 * pairing would be enough to hand out access forever.
 */
export const mayInvite = (access: Access | undefined): boolean => access !== undefined && access.sessionId === null;
