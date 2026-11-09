import { describe, expect, test } from 'bun:test';
import { serverActions } from '../actions/server-actions-test-helpers.ts';
import type { CanvasHost } from '../canvas/host.ts';
import { catalog } from '../mcp/catalog-test-helpers.ts';
import { externalCallerOf, handleExternalMcpRequest } from '../mcp/external-route.ts';
import { ClientMetadataError } from './client-metadata.ts';
import { challengeOf, ConsentBook } from './consent-book.ts';
import { CredentialStore } from './credential-store.ts';
import { FailureLimiter } from './external-gate.ts';
import { externalHandler } from './external-listener.ts';

const PORT = 4230;
const CLIENT_ID = 'https://client.example/meta.json';

const host = {
    reach: {
        enabled: () => false,
        open: async () => [{ projectId: 'p1', name: 'repo', folder: '/nowhere/repo' }],
        recent: async () => []
    }
} as unknown as CanvasHost;

function setup(): {
    handle: (path: string, init?: RequestInit) => Promise<Response>;
    credentials: CredentialStore;
    consent: ConsentBook;
    clock: { now: number };
} {
    const clock = { now: 1_000_000 };
    let counter = 0;
    const random = (bytes: number): string => `${'r'.repeat(bytes)}${(counter += 1)}`;
    const credentials = new CredentialStore({ now: () => clock.now, random });
    const consent = new ConsentBook({ now: () => clock.now, random, pick: (limit) => counter++ % limit, changed: () => undefined });
    const handler = externalHandler({
        credentials,
        consent,
        limiter: new FailureLimiter(() => clock.now),
        serve: (request, credential, client) =>
            handleExternalMcpRequest(request, externalCallerOf(credential, client), { host, actions: serverActions, tools: catalog() }),
        fetchMetadata: async (clientId) => {
            if (clientId !== CLIENT_ID) {
                throw new ClientMetadataError();
            }

            return { clientId, clientName: 'Hosted Claude', redirectUris: ['https://client.example/callback'] };
        },
        now: () => clock.now,
        port: () => PORT
    });

    return { handle: (path, init) => handler(new Request(`http://127.0.0.1:${PORT}${path}`, init)), credentials, consent, clock };
}

function mcp(token: string | null, extra: Record<string, string> = {}, method = 'tools/list'): RequestInit {
    return {
        method: 'POST',
        headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            host: `127.0.0.1:${PORT}`,
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            ...extra
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} })
    };
}

async function listed(response: Response): Promise<string[]> {
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };

    return body.result.tools.map((tool) => tool.name);
}

describe('the MCP route', () => {
    test('answers the tool list of the tier to a bearer on loopback', async () => {
        const { handle, credentials } = setup();
        const { secret } = await credentials.createBearer({ label: 'Bot', grant: { tier: 'read' } });
        const response = await handle('/mcp', mcp(secret));

        expect(response.status).toBe(200);
        expect(await listed(response)).toContain('node_list');
    });

    test('answers a bare 401 to a request with no token, whatever headers it forges', async () => {
        const { handle } = setup();

        for (const forged of [
            {} as Record<string, string>,
            { 'cf-ray': 'abc-AMS' },
            { 'cf-connecting-ip': '203.0.113.9' },
            { host: 'mcp.example.com' },
            { 'x-forwarded-for': '127.0.0.1' }
        ]) {
            const response = await handle('/mcp', mcp(null, forged));

            expect(response.status).toBe(401);
            expect(await response.text()).toBe('');
        }
    });

    test('points an unauthenticated client at the OAuth metadata of the listener', async () => {
        const { handle } = setup();
        const response = await handle('/mcp', mcp(null));

        expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource"`);
    });

    test('refuses any Origin with 403, on the route and on every other path', async () => {
        const { handle, credentials } = setup();
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        for (const path of ['/mcp', '/authorize', '/token', '/.well-known/oauth-authorization-server', '/ws', '/health']) {
            expect(
                (await handle(path, { ...mcp(secret), headers: { ...(mcp(secret).headers as Record<string, string>), origin: 'https://evil.example' } })).status
            ).toBe(403);
        }
    });

    test('refuses a session token, the local secret and an unknown token', async () => {
        const { handle } = setup();

        for (const token of ['a-session-token', 'the-local-secret', 'rmb_guess']) {
            expect((await handle('/mcp', mcp(token))).status).toBe(401);
        }
    });

    test('refuses a bearer that came through the tunnel unless its credential allows that', async () => {
        const { handle, credentials } = setup();
        const closed = await credentials.createBearer({ label: 'Closed' });
        const open = await credentials.createBearer({ label: 'Open', bearerOnHostname: true });

        expect((await handle('/mcp', mcp(closed.secret, { 'cf-ray': 'abc-AMS' }))).status).toBe(401);
        expect((await handle('/mcp', mcp(closed.secret, { host: 'mcp-abc.example.com' }))).status).toBe(401);
        expect((await handle('/mcp', mcp(open.secret, { 'cf-ray': 'abc-AMS', host: 'mcp-abc.example.com' }))).status).toBe(200);
    });

    test('counts a revoke from the next request', async () => {
        const { handle, credentials } = setup();
        const { credential, secret } = await credentials.createBearer({ label: 'Bot' });

        expect((await handle('/mcp', mcp(secret))).status).toBe(200);

        await credentials.revoke(credential.id);

        expect((await handle('/mcp', mcp(secret))).status).toBe(401);
    });

    test('slows a source down after many failures, and forgets them after a minute', async () => {
        const { handle, clock } = setup();

        for (let i = 0; i < 20; i++) {
            expect((await handle('/mcp', mcp('guess'))).status).toBe(401);
        }

        expect((await handle('/mcp', mcp('guess'))).status).toBe(429);

        clock.now += 61_000;

        expect((await handle('/mcp', mcp('guess'))).status).toBe(401);
    });
});

describe('every other path', () => {
    test('is a 404, so no API route is on the listener', async () => {
        const { handle, credentials } = setup();
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        for (const path of [
            '/',
            '/ws',
            '/health',
            '/machine/status',
            '/machine/proof',
            '/fs/file',
            '/hooks/claude',
            '/context',
            '/projects/p1/icon',
            '/auth/local-ticket',
            '/mcp/',
            '/token/x'
        ]) {
            const response = await handle(path, { headers: { authorization: `Bearer ${secret}`, 'cf-ray': 'x' } });

            expect({ path, status: response.status }).toEqual({ path, status: 404 });
        }
    });

    test('serves the OAuth metadata of a server that has no registration endpoint', async () => {
        const { handle } = setup();
        const server = (await (await handle('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;

        expect(server).toMatchObject({
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            client_id_metadata_document_supported: true
        });
        expect(server.registration_endpoint).toBeUndefined();
    });
});

describe('OAuth with consent in Ruimte', () => {
    const verifier = 'v'.repeat(64);
    const challenge = challengeOf(verifier);

    function authorizeUrl(redirect = 'https://client.example/callback', client = CLIENT_ID, method = 'S256'): string {
        const query = new URLSearchParams({
            response_type: 'code',
            client_id: client,
            redirect_uri: redirect,
            code_challenge: challenge,
            code_challenge_method: method,
            state: 'st-1'
        });

        return `/authorize?${query}`;
    }

    async function pendingPath(handle: ReturnType<typeof setup>['handle']): Promise<string> {
        const start = await handle(authorizeUrl());

        expect(start.status).toBe(302);

        return new URL(start.headers.get('location')!).pathname + new URL(start.headers.get('location')!).search;
    }

    async function exchange(handle: ReturnType<typeof setup>['handle'], code: string, overrides: Record<string, string> = {}): Promise<Response> {
        const form = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: 'https://client.example/callback',
            client_id: CLIENT_ID,
            code_verifier: verifier,
            ...overrides
        });

        return handle('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    }

    test('shows the client name and a code on a page that waits, and puts nothing to type on it', async () => {
        const { handle, consent } = setup();
        const waiting = await handle(await pendingPath(handle));
        const html = await waiting.text();
        const [request] = consent.list();

        // The host of the client's address comes first, the name its document claims only after it and as unverified.
        expect(html).toContain('<strong>client.example</strong>');
        expect(html).toContain('calls itself "Hosted Claude", which nobody has verified');
        expect(html.indexOf('client.example')).toBeLessThan(html.indexOf('Hosted Claude'));
        expect(html).toContain(request!.code);
        expect(html).not.toContain('<form');
        expect(html).not.toContain('<script');
        expect(waiting.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    test('keeps one waiting request for a client per source address, read from Cf-Connecting-Ip', async () => {
        const { handle, consent } = setup();

        for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.2']) {
            expect((await handle(authorizeUrl(), { headers: { 'cf-connecting-ip': ip } })).status).toBe(302);
        }

        // A client that asks again replaces its own request instead of piling up in the window.
        expect(consent.list()).toHaveLength(2);
    });

    test('hands a code to the client once a person approved, and the code buys tokens that work', async () => {
        const { handle, consent } = setup();
        const path = await pendingPath(handle);
        const [request] = consent.list();

        expect(consent.answer(request!.id, true, { tier: 'read' }, null)).toBe(true);

        const back = await handle(path);
        const location = new URL(back.headers.get('location')!);

        expect(back.status).toBe(302);
        expect(location.origin + location.pathname).toBe('https://client.example/callback');
        expect(location.searchParams.get('state')).toBe('st-1');

        const tokens = (await (await exchange(handle, location.searchParams.get('code')!)).json()) as {
            access_token: string;
            refresh_token: string;
            token_type: string;
        };

        expect(tokens.token_type).toBe('Bearer');
        expect(await listed(await handle('/mcp', mcp(tokens.access_token)))).not.toContain('node_new');
    });

    test('redirects a refusal to the client, and an authorization code is good once', async () => {
        const { handle, consent } = setup();
        const denied = await pendingPath(handle);

        consent.answer(consent.list()[0]!.id, false, undefined, null);

        const refused = new URL((await handle(denied)).headers.get('location')!);

        expect(refused.searchParams.get('error')).toBe('access_denied');

        const approved = await pendingPath(handle);

        consent.answer(consent.list()[0]!.id, true, undefined, null);

        const code = new URL((await handle(approved)).headers.get('location')!).searchParams.get('code')!;

        expect((await exchange(handle, code)).status).toBe(200);
        expect((await exchange(handle, code)).status).toBe(400);
    });

    test('refuses a wrong PKCE verifier, another redirect and another client at the token endpoint', async () => {
        const { handle, consent } = setup();

        for (const overrides of [
            { code_verifier: 'w'.repeat(64) } as Record<string, string>,
            { redirect_uri: 'https://client.example/other' },
            { client_id: 'https://other.example/meta.json' }
        ]) {
            const path = await pendingPath(handle);

            consent.answer(consent.list()[0]!.id, true, undefined, null);

            const code = new URL((await handle(path)).headers.get('location')!).searchParams.get('code')!;

            expect((await exchange(handle, code, overrides)).status).toBe(400);
        }
    });

    test('refuses a redirect the metadata document does not list, without redirecting there', async () => {
        const { handle, consent } = setup();
        const response = await handle(authorizeUrl('https://evil.example/callback'));

        expect(response.status).toBe(400);
        expect(response.headers.get('location')).toBeNull();
        expect(consent.list()).toEqual([]);
    });

    test('refuses a challenge method other than S256 and a client that cannot be fetched', async () => {
        const { handle } = setup();

        expect((await handle(authorizeUrl(undefined, undefined, 'plain'))).status).toBe(400);
        const unknown = await handle(authorizeUrl(undefined, 'https://unknown.example/meta.json'));

        expect(unknown.status).toBe(400);
        expect(await unknown.json()).toMatchObject({ error: 'invalid_client', error_description: 'The client could not be identified' });
    });

    test('lets a request time out when nobody approves it', async () => {
        const { handle, clock, consent } = setup();
        const path = await pendingPath(handle);

        clock.now += 6 * 60_000;

        expect(consent.list()).toEqual([]);
        expect(await (await handle(path)).text()).toContain('Nobody approved');
    });

    test('rotates the refresh token, and revokes the credential when an old one comes back', async () => {
        const { handle, consent, credentials } = setup();
        const path = await pendingPath(handle);

        consent.answer(consent.list()[0]!.id, true, undefined, null);

        const code = new URL((await handle(path)).headers.get('location')!).searchParams.get('code')!;
        const first = (await (await exchange(handle, code)).json()) as { refresh_token: string; access_token: string };
        const refresh = (token: string): Promise<Response> =>
            handle('/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: CLIENT_ID })
            });
        const second = (await (await refresh(first.refresh_token)).json()) as { refresh_token: string; access_token: string };

        expect(second.refresh_token).not.toBe(first.refresh_token);
        expect((await refresh(first.refresh_token)).status).toBe(400);
        expect(credentials.list()).toEqual([]);
        expect((await handle('/mcp', mcp(second.access_token))).status).toBe(401);
    });
});
