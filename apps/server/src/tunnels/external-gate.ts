import { bearerToken } from '../agents/bearer.ts';
import type { CredentialCheck, CredentialStore } from './credential-store.ts';

/* A request that came through a tunnel says so in the headers Cloudflare adds; these only ever refuse. */
const TUNNEL_HEADERS = ['cf-ray', 'cf-connecting-ip'] as const;

const FAILURE_WINDOW_MS = 60_000;
const FAILURES_PER_WINDOW = 20;
const MAX_TRACKED_SOURCES = 1000;

/* Whether the request carries a header only Cloudflare's edge sets. */
function hasTunnelHeaders(headers: Headers): boolean {
    return TUNNEL_HEADERS.some((name) => headers.has(name));
}

/*
 * The answer of the API port to a request that came through a tunnel: the API is never a tunnel target, so a request that
 * carries the headers Cloudflare's edge adds is refused. The headers prove nothing and only ever refuse. Null for any other request.
 */
export function refuseTunnelled(request: Request): Response | null {
    return hasTunnelHeaders(request.headers) ? new Response('The API does not answer through a tunnel', { status: 403 }) : null;
}

/*
 * Whether the `Host` is the listener's own address. A tunnel passes the public hostname on, so any other `Host` means
 * the request did not come straight from this machine. Like the headers above, this is no proof of anything: it only refuses.
 */
function isLoopbackHost(host: string | null, port: number | null): boolean {
    if (host === null) {
        return false;
    }

    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

/* Which door a request came in by, for the credential that is only allowed on one of them. */
export function doorOf(request: Request, port: number | null): 'loopback' | 'hostname' {
    return hasTunnelHeaders(request.headers) || !isLoopbackHost(request.headers.get('host'), port) ? 'hostname' : 'loopback';
}

/* The failures of one source in the last minute, so a guessed token costs time. The source is a hint for the limit and never proof. */
export class FailureLimiter {
    private readonly failures = new Map<string, number[]>();
    private readonly now: () => number;

    private readonly capacity: number;

    constructor(now: () => number, capacity = MAX_TRACKED_SOURCES) {
        this.now = now;
        this.capacity = capacity;
    }

    /* The bucket a source counts in: its own, or the shared one once the map is full and the source is not in it. */
    private bucketOf(source: string): string {
        return this.failures.size >= this.capacity && !this.failures.has(source) ? '*' : source;
    }

    private recent(source: string): number[] {
        const since = this.now() - FAILURE_WINDOW_MS;
        const kept = (this.failures.get(source) ?? []).filter((at) => at > since);

        if (kept.length === 0) {
            this.failures.delete(source);
        } else {
            this.failures.set(source, kept);
        }

        return kept;
    }

    blocked(source: string): boolean {
        // A flood from many sources fills the shared bucket, and then every source that is not tracked is slowed down with it.
        return this.recent(this.bucketOf(source)).length >= FAILURES_PER_WINDOW;
    }

    fail(source: string): void {
        // A flood from many sources shares one bucket instead of growing the map.
        const bucket = this.bucketOf(source);

        this.failures.set(bucket, [...this.recent(bucket), this.now()]);
    }
}

type GateResult = { ok: true; credential: CredentialCheck & { ok: true } } | { ok: false; response: Response };

export function challenge(metadataUrl: string | null): Response {
    return new Response(null, {
        status: 401,
        headers: {
            'cache-control': 'no-store',
            ...(metadataUrl === null ? {} : { 'www-authenticate': `Bearer resource_metadata="${metadataUrl}"` })
        }
    });
}

/*
 * Judges a request to the external MCP route: no `Origin` at all, and a credential of our own on every request.
 * The source address, `Host`, `Cf-*` headers and `local.key` prove nothing, so a failure is a bare 401 for all of them.
 */
export function gateRequest(
    request: Request,
    port: number | null,
    credentials: Pick<CredentialStore, 'authenticate'>,
    limiter: FailureLimiter,
    metadataUrl: string | null
): GateResult {
    if (request.headers.has('origin')) {
        return { ok: false, response: new Response('Origin not allowed', { status: 403 }) };
    }

    const source = request.headers.get('cf-connecting-ip') ?? 'direct';

    if (limiter.blocked(source)) {
        return { ok: false, response: new Response(null, { status: 429, headers: { 'retry-after': '60' } }) };
    }

    const token = bearerToken(request);

    if (token === null) {
        limiter.fail(source);

        return { ok: false, response: challenge(metadataUrl) };
    }

    const checked = credentials.authenticate(token, doorOf(request, port));

    if (!checked.ok) {
        limiter.fail(source);

        return { ok: false, response: challenge(metadataUrl) };
    }

    return { ok: true, credential: checked };
}
