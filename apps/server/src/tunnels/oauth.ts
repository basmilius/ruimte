import { allowedRedirect, CLIENT_NOT_IDENTIFIED, clientHost, type ClientMetadata } from './client-metadata.ts';
import type { ConsentBook } from './consent-book.ts';
import type { CredentialStore } from './credential-store.ts';
import { challenge as unauthorized, FailureLimiter } from './external-gate.ts';

export const OAUTH_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
const OAUTH_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
const OAUTH_AUTHORIZE_PATH = '/authorize';
const OAUTH_TOKEN_PATH = '/token';

interface OAuthDeps {
    credentials: CredentialStore;
    consent: ConsentBook;
    limiter: FailureLimiter;
    fetchMetadata(clientId: string): Promise<ClientMetadata>;
    now(): number;
    /* The address a client reaches the MCP route at, from the request it just made. */
    baseOf(request: Request): string;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function oauthError(error: string, description: string, status = 400): Response {
    return json({ error, error_description: description }, status);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escaped(text: string): string {
    return text.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

/* The page a client's browser shows while a person approves in Ruimte. No script, no form, and nothing on it to guess or type. */
function waitingPage(client: { host: string; name: string } | null, code: string, pendingUrl: string, timedOut = false): Response {
    // The host is where the client's document came from. The name is whatever that document says, so it comes second.
    const body =
        timedOut || client === null
            ? '<p>Nobody approved this in Ruimte in time. Start the connection again from the client.</p>'
            : `<p><strong>${escaped(client.host)}</strong> asks to use Ruimte on this person's machine. It calls itself "${escaped(client.name)}", which nobody has verified.</p><p>Check that Ruimte shows this code, then approve it there:</p><p class="code">${escaped(code)}</p><p>This page goes on by itself.</p>`;

    return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Connect to Ruimte</title>${timedOut ? '' : `<meta http-equiv="refresh" content="2;url=${escaped(pendingUrl)}">`}<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}.code{font:600 2rem ui-monospace,monospace;letter-spacing:.3rem}</style></head><body>${body}</body></html>`,
        {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
                'x-frame-options': 'DENY',
                'referrer-policy': 'no-referrer'
            }
        }
    );
}

function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

function withParameters(target: string, parameters: Record<string, string | null>): string {
    const url = new URL(target);

    for (const [name, value] of Object.entries(parameters)) {
        if (value !== null) {
            url.searchParams.set(name, value);
        }
    }

    return url.href;
}

/* Protected resource metadata (RFC 9728) and the authorization server metadata (RFC 8414), which name no secret. */
function metadataResponse(request: Request, path: string, deps: OAuthDeps): Response {
    const base = deps.baseOf(request);

    if (path === OAUTH_PROTECTED_RESOURCE_PATH) {
        return json({ resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] });
    }

    return json({
        issuer: base,
        authorization_endpoint: `${base}${OAUTH_AUTHORIZE_PATH}`,
        token_endpoint: `${base}${OAUTH_TOKEN_PATH}`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true
    });
}

/* `/authorize`: asks a person on this machine, in Ruimte. The page here only waits; the answer is not given on it. */
async function authorize(request: Request, url: URL, deps: OAuthDeps): Promise<Response> {
    if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
    }

    const pendingId = url.searchParams.get('pending');

    if (pendingId !== null) {
        const poll = deps.consent.poll(pendingId);
        const here = `${deps.baseOf(request)}${OAUTH_AUTHORIZE_PATH}?pending=${encodeURIComponent(pendingId)}`;

        if (poll.status === 'pending') {
            const waiting = deps.consent.list().find((entry) => entry.id === pendingId);

            return waiting === undefined
                ? waitingPage(null, '', here, true)
                : waitingPage({ host: clientHost(waiting.clientUrl), name: waiting.clientName }, waiting.code, here);
        }

        if (poll.status === 'gone') {
            return waitingPage(null, '', here, true);
        }

        if (poll.status === 'denied') {
            return redirect(withParameters(poll.pending.redirectUri, { error: 'access_denied', state: poll.pending.state }));
        }

        return redirect(withParameters(poll.pending.redirectUri, { code: poll.authorizationCode, state: poll.pending.state }));
    }

    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const challenge = url.searchParams.get('code_challenge') ?? '';

    if (
        url.searchParams.get('response_type') !== 'code' ||
        url.searchParams.get('code_challenge_method') !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    ) {
        return oauthError('invalid_request', 'Ruimte takes the authorization code flow with PKCE S256');
    }

    let metadata: ClientMetadata;

    try {
        metadata = await deps.fetchMetadata(clientId);
    } catch {
        return oauthError('invalid_client', CLIENT_NOT_IDENTIFIED);
    }

    // Judged before anything redirects: an address the document does not list is never redirected to.
    if (!allowedRedirect(redirectUri, metadata)) {
        return oauthError('invalid_request', 'redirect_uri is not one the client metadata document lists');
    }

    const state = url.searchParams.get('state');
    const source = request.headers.get('cf-connecting-ip') ?? 'direct';
    const pending = deps.consent.request({ clientId, clientName: metadata.clientName, redirectUri, state, challenge, source });

    if (pending === null) {
        return oauthError('temporarily_unavailable', 'Too many clients wait for approval', 503);
    }

    return redirect(`${deps.baseOf(request)}${OAUTH_AUTHORIZE_PATH}?pending=${encodeURIComponent(pending.id)}`);
}

function tokenBody(tokens: { accessToken: string; refreshToken: string; expiresInS: number }): Response {
    return json({ access_token: tokens.accessToken, token_type: 'Bearer', expires_in: tokens.expiresInS, refresh_token: tokens.refreshToken });
}

/* `/token`: trades an approved authorization code, or a refresh token, for tokens. A reused refresh token revokes the credential. */
async function token(request: Request, deps: OAuthDeps): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const source = request.headers.get('cf-connecting-ip') ?? 'direct';

    if (deps.limiter.blocked(source)) {
        return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
    }

    const form = new URLSearchParams(await request.text().catch(() => ''));
    const grantType = form.get('grant_type');
    const clientId = form.get('client_id') ?? '';
    const refused = (): Response => {
        deps.limiter.fail(source);

        return oauthError('invalid_grant', 'That grant is not valid');
    };

    if (grantType === 'authorization_code') {
        const settled = deps.consent.exchange(form.get('code') ?? '', {
            clientId,
            redirectUri: form.get('redirect_uri') ?? '',
            verifier: form.get('code_verifier') ?? ''
        });

        if (settled?.decision?.approved !== true) {
            return refused();
        }

        const created = await deps.credentials.createOAuth({
            label: settled.clientName,
            clientId,
            grant: settled.decision.grant,
            expiresAt: settled.decision.expiresAt
        });

        return tokenBody(created.tokens);
    }

    if (grantType === 'refresh_token') {
        const refreshed = await deps.credentials.refresh(form.get('refresh_token') ?? '', clientId);

        return refreshed.ok ? tokenBody(refreshed.tokens) : refused();
    }

    return oauthError('unsupported_grant_type', 'Ruimte takes authorization_code and refresh_token');
}

/* Answers one of the fixed OAuth paths; null for any other path. */
export async function handleOAuthRequest(request: Request, url: URL, deps: OAuthDeps): Promise<Response | null> {
    switch (url.pathname) {
        case OAUTH_PROTECTED_RESOURCE_PATH:
        case OAUTH_SERVER_METADATA_PATH:
            return request.method === 'GET' ? metadataResponse(request, url.pathname, deps) : new Response('Method not allowed', { status: 405 });
        case OAUTH_AUTHORIZE_PATH:
            return authorize(request, url, deps);
        case OAUTH_TOKEN_PATH:
            return token(request, deps);
        default:
            return null;
    }
}

export { unauthorized };
