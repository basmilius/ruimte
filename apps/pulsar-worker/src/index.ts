import { ProviderIdSchema } from '@ruimte/pulsar';
import { readBenchmarks, refreshBenchmarks } from './benchmarks.ts';
import { refreshDeployedBenchmarks } from './deploy-benchmarks.ts';
import { readCatalogs } from './catalog.ts';
import { changePushDevice, registerPushDevice, sendPush } from './push.ts';
import { statementKeyOf } from './crypto.ts';
import type { Env } from './env.ts';
import { allowedOrigin, corsHeaders, failure, json } from './http.ts';
import { endSession, exchangeLoginCode, finishLogin, refreshSession, startLogin } from './login.ts';
import { deleteAccount } from './account-deletion.ts';
import { approveDeviceLink, cancelDeviceLink, completeDeviceLink, denyDeviceLink, lookupDeviceLink, pollDeviceLink, startDeviceLink } from './device.ts';
import { completeIdentityLink, getAccount, listProviders, startIdentityLink, unlinkIdentity } from './identities.ts';
import { deleteMachine, listMachines, registerMachine } from './machines.ts';
import { PROVIDERS } from './providers.ts';
import { issueStatement } from './statements.ts';
import { completeNativeApple, startNativeApple } from './native-apple.ts';

// Rows past use for this long are dropped by the daily cleanup; the statement log is kept.
const REVOKED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60_000;

// Four pages every three hours is 32 of the 100 requests a day the free tier allows; hourly would be 96. Mirrors `wrangler.jsonc`.
const BENCHMARKS_CRON = '17 */3 * * *';

type Handler = (request: Request, env: Env) => Response | Promise<Response>;

const ROUTES: Readonly<Record<string, Readonly<Record<string, Handler>>>> = {
    '/v1/apple/start': { POST: startNativeApple },
    '/v1/apple/complete': { POST: completeNativeApple },
    '/v1/push/devices': { POST: registerPushDevice },
    '/v1/push': { POST: (request, env) => sendPush(request, env) },
    '/v1/providers': { GET: (_request, env) => listProviders(env) },
    '/v1/models/benchmarks': { GET: (_request, env) => readBenchmarks(env) },
    '/v1/models/catalog': { GET: () => readCatalogs() },
    '/v1/account': { GET: getAccount, DELETE: deleteAccount },
    '/v1/account/link': { POST: startIdentityLink },
    '/v1/account/identities': { POST: completeIdentityLink },
    '/v1/machines': { GET: listMachines, POST: registerMachine },
    '/v1/statements': { POST: issueStatement },
    '/v1/session': { POST: exchangeLoginCode, DELETE: endSession },
    '/v1/session/refresh': { POST: refreshSession }
};

const DEVICE_ROUTES: Readonly<Record<string, Handler>> = {
    start: startDeviceLink,
    poll: pollDeviceLink,
    complete: completeDeviceLink,
    cancel: cancelDeviceLink,
    lookup: lookupDeviceLink,
    approve: approveDeviceLink,
    deny: denyDeviceLink
};

function ownEntry<Value>(table: Readonly<Record<string, Value>> | undefined, key: string): Value | undefined {
    return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

async function health(env: Env): Promise<Response> {
    let statementKey: string | null = null;
    if (env.STATEMENT_PRIVATE_KEY) {
        statementKey = await statementKeyOf(env.STATEMENT_PRIVATE_KEY)
            .then((key) => key.publicKey)
            .catch(() => 'unreadable');
    }
    const providers = Object.fromEntries(Object.values(PROVIDERS).map((provider) => [provider.id, provider.configured(env)]));
    return json({ ok: true, statementKey, providers });
}

async function api(request: Request, env: Env, path: string): Promise<Response> {
    const method = request.method;
    const exact = ownEntry(ownEntry(ROUTES, path), method);
    if (exact) {
        return exact(request, env);
    }
    const pushDevice = /^\/v1\/push\/devices\/([A-Za-z0-9_-]{43})(?:\/(activities|start-activity))?$/.exec(path);
    if (pushDevice && ((method === 'DELETE' && !pushDevice[2]) || (method === 'PUT' && pushDevice[2]))) {
        return changePushDevice(request, env, pushDevice[1]!, pushDevice[2] === 'activities' ? 'update' : pushDevice[2] === 'start-activity' ? 'start' : null);
    }
    const identity = /^\/v1\/account\/identities\/([a-z]+)$/.exec(path)?.[1];
    if (identity !== undefined && method === 'DELETE') {
        return unlinkIdentity(request, env, identity);
    }
    const machine = /^\/v1\/machines\/([^/]+)$/.exec(path);
    if (machine?.[1] && method === 'DELETE') {
        return deleteMachine(request, env, machine[1]);
    }
    const device = /^\/v1\/device\/([a-z]+)$/.exec(path)?.[1];
    const deviceRoute = device !== undefined && method === 'POST' ? ownEntry(DEVICE_ROUTES, device) : undefined;
    if (deviceRoute) {
        return deviceRoute(request, env);
    }
    return failure('not-found', 'No such route');
}

async function route(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/internal/benchmarks/refresh' && request.method === 'POST') {
        return refreshDeployedBenchmarks(request, env);
    }
    if (path === '/health' && request.method === 'GET') {
        return health(env);
    }
    if (path === '/.well-known/apple-developer-domain-association.txt' && request.method === 'GET' && env.APPLE_DOMAIN_ASSOCIATION) {
        return new Response(env.APPLE_DOMAIN_ASSOCIATION, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const auth = /^\/auth\/([a-z]+)\/(start|callback)$/.exec(path);
    if (auth) {
        const providerId = ProviderIdSchema.safeParse(auth[1]);
        const provider = providerId.success ? PROVIDERS[providerId.data] : undefined;
        if (!provider) {
            return failure('not-found', 'No such sign-in provider');
        }
        if (auth[2] === 'start' && request.method === 'GET') {
            return startLogin(request, env, provider);
        }
        if (auth[2] === 'callback' && request.method === provider.callbackMethod) {
            return finishLogin(request, env, provider);
        }
        return failure('not-found', 'No such route');
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
}

export default {
    async fetch(request, env) {
        try {
            return await route(request, env);
        } catch (error) {
            console.error('unhandled', error);
            return failure('internal', 'Something went wrong in the address book');
        }
    },
    async scheduled(controller, env) {
        if (controller.cron === BENCHMARKS_CRON) {
            await refreshBenchmarks(env);
            return;
        }
        const now = Date.now();
        await env.DB.batch([
            env.DB.prepare('DELETE FROM push_activity_start WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM push_receipt WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM push_device WHERE session_id IN (SELECT id FROM session WHERE revoked_at IS NOT NULL OR expires_at <= ?1)').bind(now),
            env.DB.prepare('DELETE FROM login_attempt WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM native_apple_login WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM login_code WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM identity_link_request WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM identity_link_code WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM device_link WHERE expires_at <= ?1').bind(now),
            env.DB.prepare('DELETE FROM rate_limit WHERE window_start < ?1').bind(now - 60 * 60_000),
            env.DB.prepare('DELETE FROM session WHERE expires_at <= ?1 OR revoked_at <= ?2').bind(now, now - REVOKED_SESSION_RETENTION_MS)
        ]);
    }
} satisfies ExportedHandler<Env>;
