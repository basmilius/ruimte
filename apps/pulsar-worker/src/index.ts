import { ProviderIdSchema } from '@ruimte/pulsar';
import { statementKeyOf } from './crypto.ts';
import type { Env } from './env.ts';
import { allowedOrigin, corsHeaders, failure, json } from './http.ts';
import { endSession, exchangeLoginCode, finishLogin, refreshSession, startLogin } from './login.ts';
import { approveDeviceLink, cancelDeviceLink, completeDeviceLink, denyDeviceLink, lookupDeviceLink, pollDeviceLink, startDeviceLink } from './device.ts';
import { deleteMachine, listMachines, registerMachine } from './machines.ts';
import { PROVIDERS } from './providers.ts';
import { issueStatement } from './statements.ts';

// Rows past use for this long are dropped by the daily cleanup; the statement log is kept.
const REVOKED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60_000;

const DEVICE_ROUTES: Record<string, (request: Request, env: Env) => Promise<Response>> = {
    start: startDeviceLink,
    poll: pollDeviceLink,
    complete: completeDeviceLink,
    cancel: cancelDeviceLink,
    lookup: lookupDeviceLink,
    approve: approveDeviceLink,
    deny: denyDeviceLink
};

const health = async (env: Env): Promise<Response> => {
    let statementKey: string | null = null;
    if (env.STATEMENT_PRIVATE_KEY) {
        statementKey = await statementKeyOf(env.STATEMENT_PRIVATE_KEY)
            .then((key) => key.publicKey)
            .catch(() => 'unreadable');
    }
    const providers = Object.fromEntries(Object.values(PROVIDERS).map((provider) => [provider.id, provider.configured(env)]));
    return json({ ok: true, statementKey, providers });
};

const api = async (request: Request, env: Env, path: string): Promise<Response> => {
    const method = request.method;
    if (path === '/v1/machines') {
        if (method === 'GET') {
            return listMachines(request, env);
        }
        if (method === 'POST') {
            return registerMachine(request, env);
        }
    }
    const machine = /^\/v1\/machines\/([^/]+)$/.exec(path);
    if (machine?.[1] && method === 'DELETE') {
        return deleteMachine(request, env, machine[1]);
    }
    if (path === '/v1/statements' && method === 'POST') {
        return issueStatement(request, env);
    }
    const device = /^\/v1\/device\/([a-z]+)$/.exec(path)?.[1];
    if (device !== undefined && method === 'POST') {
        const handler = DEVICE_ROUTES[device];
        if (handler) {
            return handler(request, env);
        }
    }
    if (path === '/v1/session') {
        if (method === 'POST') {
            return exchangeLoginCode(request, env);
        }
        if (method === 'DELETE') {
            return endSession(request, env);
        }
    }
    if (path === '/v1/session/refresh' && method === 'POST') {
        return refreshSession(request, env);
    }
    return failure('not-found', 'No such route');
};

const route = async (request: Request, env: Env): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
        return health(env);
    }
    const auth = /^\/auth\/([a-z]+)\/(start|callback)$/.exec(path);
    if (auth && request.method === 'GET') {
        const providerId = ProviderIdSchema.safeParse(auth[1]);
        const provider = providerId.success ? PROVIDERS[providerId.data] : undefined;
        if (!provider) {
            return failure('not-found', 'No such sign-in provider');
        }
        return auth[2] === 'start' ? startLogin(request, env, provider) : finishLogin(request, env, provider);
    }
    if (path.startsWith('/v1/')) {
        const cors = corsHeaders(allowedOrigin(request, env));
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }
        const response = await api(request, env, path);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) {
            headers.set(name, value);
        }
        return new Response(response.body, { status: response.status, headers });
    }
    return failure('not-found', 'No such route');
};

export default {
    async fetch(request, env) {
        try {
            return await route(request, env);
        } catch (error) {
            console.error('unhandled', error);
            return failure('internal', 'Something went wrong in the address book');
        }
    },
    async scheduled(_controller, env) {
        const now = Date.now();
        await env.DB.batch([
            env.DB.prepare('DELETE FROM login_attempt WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM login_code WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM device_link WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM rate_limit WHERE window_start < ?1').bind(now - 60 * 60_000),
            env.DB.prepare('DELETE FROM session WHERE expires_at <= ?1 OR revoked_at <= ?2').bind(now, now - REVOKED_SESSION_RETENTION_MS)
        ]);
    }
} satisfies ExportedHandler<Env>;
