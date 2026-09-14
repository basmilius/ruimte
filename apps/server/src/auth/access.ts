import type { Reachability } from '@ruimte/contracts';
import type { AuthStore } from './auth-store.ts';
import { sameSecret } from './local-secret.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export const isLoopbackAddress = (address: string): boolean => LOOPBACK.has(address) || address.startsWith('127.');

const isLoopbackHost = (host: string): boolean => LOOPBACK.has(host.replace(/^\[|\]$/g, '').replace(/:\d+$/, ''));

const isPrivateAddress = (address: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fd)/i.test(address.replace(/^::ffff:/, ''));

/* What a connection's address says about how far away the client is. */
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

type AccessDecision = { ok: true; access: Access } | { ok: false; status: number; reason: string };

export interface AccessOptions {
    allowedOrigins: string[];
    // The secret in `$RUIMTE_HOME/local.key`, which is what a process on this machine presents.
    localSecret: string;
    // What turns a connection ticket back into a session; the handshake that handed it out.
    tickets: { ticketSession(ticket: string): string | null };
}

/*
 * Decides whether an upgrade or an API request may proceed and as whom. The source address never
 * grants anything: a tunnel or a reverse proxy makes every visitor loopback. It still decides
 * `reachability`, which only says how far away the client probably is.
 */
export const decideAccess = async (request: Request, remoteAddress: string, store: AuthStore, options: AccessOptions): Promise<AccessDecision> => {
    if (!originAllowed(request.headers.get('origin'), request.headers.get('host'), options.allowedOrigins)) {
        return { ok: false, status: 403, reason: 'Origin not allowed' };
    }
    const reachability = reachabilityOf(remoteAddress);
    const url = new URL(request.url);
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (url.searchParams.get('token') ?? '');
    if (!token) {
        return { ok: false, status: 401, reason: 'Pair this client first' };
    }
    if (sameSecret(token, options.localSecret)) {
        return { ok: true, access: { reachability, sessionId: null } };
    }
    // A ticket first: it is what a client that signs for itself carries, and it costs no disk.
    const sessionId = options.tickets.ticketSession(token) ?? (await store.authenticate(token));
    if (sessionId) {
        return { ok: true, access: { reachability, sessionId } };
    }
    return { ok: false, status: 401, reason: 'Unknown token' };
};

/*
 * The one rule for minting a pairing link, over HTTP and over the socket alike: only a client that
 * presented the local secret may invite another machine. A paired client may not, or a single
 * pairing would be enough to hand out access forever.
 */
export const mayInvite = (access: Access | undefined): boolean => access !== undefined && access.sessionId === null;
