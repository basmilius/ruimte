import { DESKTOP_APP_ORIGIN, type AuthTicketResult, type Reachability } from '@ruimte/contracts';
import type { TicketGrant, TicketUse } from './handshake.ts';
import { sameSecret } from './local-secret.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export const isLoopbackAddress = (address: string): boolean => LOOPBACK.has(address) || address.startsWith('127.');

const isLoopbackHost = (host: string): boolean => LOOPBACK.has(host.replace(/^\[|\]$/g, '').replace(/:\d+$/, ''));

const isPrivateAddress = (address: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fd)/i.test(address.replace(/^::ffff:/, ''));

export const reachabilityOf = (address: string): Reachability => (isLoopbackAddress(address) ? 'loopback' : isPrivateAddress(address) ? 'lan' : 'public');

/*
 * A browser sends the page's origin with the upgrade; a page that is not ours must not drive
 * the daemon with the person's cookies-free but reachable socket. Our own origin, the desktop app's
 * own scheme and any loopback origin (the dev server) pass; no header passes too, since that is a
 * non-browser client which has to hold a credential anyway.
 */
export const originAllowed = (origin: string | null, host: string | null): boolean => {
    if (!origin || origin === DESKTOP_APP_ORIGIN) {
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
    return host !== null && parsed.host === host;
};

/*
 * What a response tells a page on an origin the socket takes. The desktop app's page lives on a scheme
 * of its own, so every HTTP request it makes to the daemon (the local ticket, bytes, icons, attachments,
 * live streams) crosses origins. A credential rides as a bearer or in the query, never as a cookie, so
 * naming the origin hands a page nothing it could not already ask for. Null for any other origin.
 */
export const crossOriginHeaders = (request: Request): Record<string, string> | null => {
    const origin = request.headers.get('origin');
    if (!origin || !originAllowed(origin, request.headers.get('host'))) {
        return null;
    }
    return {
        'access-control-allow-origin': origin,
        vary: 'origin',
        'access-control-expose-headers': 'content-length, content-range, accept-ranges, content-type'
    };
};

/* The answer to a preflight from such a page, private network access included, since the daemon sits on loopback. */
export const preflightHeaders = (cors: Record<string, string>): Record<string, string> => ({
    ...cors,
    'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE',
    'access-control-allow-headers': 'authorization, content-type, range',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600'
});

/* `response` with `headers` on top. A response whose headers are fixed (a redirect, a fetched one) is copied rather than changed. */
export const withHeaders = (response: Response, headers: Record<string, string>): Response => {
    try {
        for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
        }
        return response;
    } catch {
        const merged = new Headers(response.headers);
        for (const [name, value] of Object.entries(headers)) {
            merged.set(name, value);
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
    }
};

export interface Access {
    reachability: Reachability;
    // The session behind a ticket, or null for a client that presented the local secret.
    sessionId: string | null;
}

// `ticket` is the ticket that got in, which a socket gives back when it closes.
type AccessDecision = { ok: true; access: Access; ticket?: string } | { ok: false; status: number; reason: string };

export interface AccessOptions {
    // The secret in `$RUIMTE_HOME/local.key`, which is what a process on this machine presents.
    localSecret: string;
    // What turns a connection ticket back into a session; the handshake that handed it out.
    tickets: { ticketAccess(ticket: string, use: TicketUse): Promise<TicketGrant | null> };
}

/*
 * What a request is for, which decides the credentials it takes. `local` takes the local secret
 * itself and never a ticket, since a ticket sits in URLs that get copied.
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
export const decideAccess = async (request: Request, remoteAddress: string, options: AccessOptions, use: AccessUse): Promise<AccessDecision> => {
    if (!originAllowed(request.headers.get('origin'), request.headers.get('host'))) {
        return { ok: false, status: 403, reason: 'Origin not allowed' };
    }
    const reachability = reachabilityOf(remoteAddress);
    const token = bearerOf(request) || (new URL(request.url).searchParams.get('token') ?? '');
    if (!token) {
        return { ok: false, status: 401, reason: 'Only the app on this machine or a device its account let in gets in' };
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
    return { ok: false, status: 401, reason: 'Unknown token' };
};

/*
 * Trades the local secret for a ticket, so the app on this machine puts that in its socket and byte
 * URLs rather than a secret that never expires and puts the machine on an account. The secret is taken from
 * the Authorization header alone: a request that carries it in its URL has already leaked it.
 */
export const handleLocalTicketRequest = (request: Request, options: AccessOptions, tickets: { issueLocalTicket(): AuthTicketResult }): Response => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    if (!originAllowed(request.headers.get('origin'), request.headers.get('host'))) {
        return new Response('Origin not allowed', { status: 403 });
    }
    const secret = bearerOf(request);
    if (!secret || !sameSecret(secret, options.localSecret)) {
        return new Response('That is not the secret of this machine', { status: 401 });
    }
    return Response.json(tickets.issueLocalTicket());
};

/*
 * Whether a client is the owner of this machine: a process on it that presented the local secret. Only
 * the owner puts the machine on an account or takes it off, since a client the machine let in could
 * otherwise hand it to an account of its choosing.
 */
export const isOwner = (access: Access | undefined): boolean => access !== undefined && access.sessionId === null;
