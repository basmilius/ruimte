import { mapsSecretBytes, verifyMapsTicket } from '@ruimte/pulsar';
import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { pathFor, readGrant } from './grant.ts';
import { allowedOrigin, corsHeaders, failure, json } from './http.ts';
import { fetchMapResource } from './map.ts';

const STYLE_PATH = 'maps/orbis/assets/styles/0.6.*/style';

// Monochrome, so the markers of a block carry the color.
const STYLE_OF = { light: 'basic_street-light', dark: 'basic_street-dark' } as const;

/* The ticket of a request: its `authorization` bearer, checked with the secret alone. */
async function subjectOf(request: Request, env: Env, deps: Deps): Promise<string | null> {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1] || !env.MAP_TICKET_SECRET) {
        return null;
    }
    return (await verifyMapsTicket(env.MAP_TICKET_SECRET, match[1], deps.now()))?.subject ?? null;
}

/* A resource the style named: `<grant>/<tail>`, taken from the path as it was sent and never decoded. */
async function granted(rest: string, env: Env, deps: Deps): Promise<Response> {
    const slash = rest.indexOf('/');
    const grant = slash === -1 ? null : await readGrant(env.MAP_TICKET_SECRET!, rest.slice(0, slash));
    const path = grant === null ? null : pathFor(grant, rest.slice(slash + 1));
    return grant === null || path === null ? failure('not-found', 'No such map resource') : fetchMapResource(deps, env, { path, query: grant.query });
}

async function api(request: Request, env: Env, deps: Deps): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true });
    }
    if (!env.TOMTOM_API_KEY || !env.MAP_TICKET_SECRET || mapsSecretBytes(env.MAP_TICKET_SECRET) === null) {
        return failure('maps-unconfigured', 'The maps service is not configured yet');
    }
    const subject = await subjectOf(request, env, deps);
    if (subject === null) {
        return failure('bad-ticket', 'Ask the address book for a new map ticket');
    }
    if (env.TICKET_LIMIT && !(await env.TICKET_LIMIT.limit({ key: subject })).success) {
        return failure('rate-limited', 'Too many map requests, try again in a minute', { 'retry-after': '60' });
    }
    if (request.method === 'GET' && url.pathname === '/v1/style') {
        const theme = url.searchParams.get('theme');
        if (theme !== 'light' && theme !== 'dark') {
            return failure('bad-request', 'theme is light or dark');
        }
        return fetchMapResource(
            deps,
            env,
            {
                path: STYLE_PATH,
                query: [
                    ['apiVersion', '1'],
                    ['map', STYLE_OF[theme]]
                ]
            },
            true
        );
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/m/')) {
        return granted(url.pathname.slice('/v1/m/'.length), env, deps);
    }
    return failure('not-found', 'No such route');
}

/* Every answer, a failure included, says which page may read it; a preflight needs no ticket. */
export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
    const cors = corsHeaders(allowedOrigin(request, env));
    const response =
        request.method === 'OPTIONS'
            ? new Response(null, { status: 204 })
            : await api(request, env, deps).catch((e: unknown) => {
                  deps.report?.(e);

                  return failure('internal', 'Something went wrong in the maps service');
              });

    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) {
        headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
}
