import type { Server } from 'bun';
import { externalCallerOf, handleExternalMcpRequest, type ExternalMcpDeps } from '../mcp/external-route.ts';
import type { ClientMetadata } from './client-metadata.ts';
import type { ConsentBook } from './consent-book.ts';
import type { CredentialStore } from './credential-store.ts';
import { doorOf, FailureLimiter, gateRequest } from './external-gate.ts';
import { handleOAuthRequest, OAUTH_PROTECTED_RESOURCE_PATH } from './oauth.ts';

/* The one route, beside the fixed OAuth paths. Nothing else answers on the listener. */
export const EXTERNAL_MCP_PATH = '/mcp';

// Tools answer within 100 seconds; the connection outlives that by a little.
const REQUEST_TIMEOUT_S = 115;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface ExternalListenerDeps {
    credentials: CredentialStore;
    consent: ConsentBook;
    limiter: FailureLimiter;
    mcp: ExternalMcpDeps;
    fetchMetadata(clientId: string): Promise<ClientMetadata>;
    now(): number;
    /* The port the listener answers on now. */
    port(): number | null;
}

/*
 * What the listener answers. A request with an `Origin` is refused whatever it asks. The MCP route judges a credential
 * of its own on every request: the source address, `Host`, `Cf-*` headers, `local.key` and a session token are no proof.
 * A path that is none of the route and the fixed OAuth paths is a 404, so no API route is on this port.
 */
export function externalHandler(deps: ExternalListenerDeps): (request: Request) => Promise<Response> {
    const baseOf = (request: Request): string => {
        const port = deps.port();
        const host = request.headers.get('host')?.toLowerCase().split(':')[0] ?? '';

        return doorOf(request, port) === 'hostname' && HOSTNAME.test(host) ? `https://${host}` : `http://127.0.0.1:${port}`;
    };

    return async (request) => {
        if (request.headers.has('origin')) {
            return new Response('Origin not allowed', { status: 403 });
        }

        const url = new URL(request.url);

        if (url.pathname === EXTERNAL_MCP_PATH) {
            const gated = gateRequest(request, deps.port(), deps.credentials, deps.limiter, `${baseOf(request)}${OAUTH_PROTECTED_RESOURCE_PATH}`);

            return gated.ok ? handleExternalMcpRequest(request, externalCallerOf(gated.credential.credential), deps.mcp) : gated.response;
        }

        const oauth = await handleOAuthRequest(request, url, {
            credentials: deps.credentials,
            consent: deps.consent,
            limiter: deps.limiter,
            fetchMetadata: deps.fetchMetadata,
            now: deps.now,
            baseOf
        });

        return oauth ?? new Response('Not found', { status: 404 });
    };
}

/* The listener on `127.0.0.1` with a port of its own, on only while the MCP is on. The daemon's API port is never this one. */
export class ExternalListener {
    private server: Server<undefined> | null = null;
    private readonly handler: (request: Request) => Promise<Response>;
    private readonly wanted: number;

    constructor(handler: (request: Request) => Promise<Response>, wantedPort: number) {
        this.handler = handler;
        this.wanted = wantedPort;
    }

    get port(): number | null {
        return this.server?.port ?? null;
    }

    start(): number {
        if (this.server !== null) {
            return this.server.port ?? this.wanted;
        }

        const handler = this.handler;
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: this.wanted,
            maxRequestBodySize: MAX_BODY_BYTES,
            async fetch(request, serving) {
                serving.timeout(request, REQUEST_TIMEOUT_S);

                return handler(request);
            }
        });

        this.server = server;

        return server.port ?? this.wanted;
    }

    /* Closes the listener and the connections on it; an agent already started keeps running. */
    stop(): void {
        void this.server?.stop(true);
        this.server = null;
    }
}
