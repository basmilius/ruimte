import type { PushEnvelope } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { signEs256Jwt } from './jwt.ts';

type ApnsEnvironment = 'sandbox' | 'production';

interface ApnsTarget {
    token: string;
    environment: ApnsEnvironment;
    startsActivity: boolean;
}
export interface ApnsResult {
    ok: boolean;
    status: number;
}

const tokens = new Map<ApnsEnvironment, { secret: string; keyId: string; teamId: string; issuedAt: number; token: Promise<string> }>();

const credentials = (env: Env, environment: ApnsEnvironment) =>
    environment === 'sandbox'
        ? { secret: env.APNS_SANDBOX_KEY, keyId: env.APNS_SANDBOX_KEY_ID }
        : { secret: env.APNS_PRODUCTION_KEY, keyId: env.APNS_PRODUCTION_KEY_ID };

const providerToken = (env: Env, environment: ApnsEnvironment, now: number): Promise<string> => {
    const selected = credentials(env, environment);
    const secret = selected.secret!;
    const keyId = selected.keyId!;
    const teamId = env.APNS_TEAM_ID!;
    const cached = tokens.get(environment);
    if (
        cached &&
        cached.secret === secret &&
        cached.keyId === keyId &&
        cached.teamId === teamId &&
        now >= cached.issuedAt &&
        now - cached.issuedAt < 50 * 60_000
    ) {
        return cached.token;
    }
    const token = (async () => {
        const body = secret.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
        const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
        const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        return signEs256Jwt(key, { kid: keyId }, { iss: teamId, iat: Math.floor(now / 1000) });
    })();
    tokens.set(environment, { secret, keyId, teamId, issuedAt: now, token });
    void token.catch(() => {
        if (tokens.get(environment)?.token === token) {
            tokens.delete(environment);
        }
    });
    return token;
};

export const apnsConfigured = (env: Env, environment: ApnsEnvironment): boolean => {
    const { secret, keyId } = credentials(env, environment);
    return !!(secret && keyId && env.APNS_TEAM_ID && env.APNS_TOPIC);
};

export const apnsPayload = (push: PushEnvelope, startsActivity: boolean): object => {
    if (push.pushType === 'alert') {
        return { aps: { alert: { title: 'Ruimte', body: 'An agent has an update for you.' }, 'mutable-content': 1, sound: 'default' }, ruimte: push };
    }
    const done = push.activity.phase === 'done';
    return {
        aps: {
            timestamp: Math.floor(push.issuedAt / 1000),
            event: done ? 'end' : startsActivity ? 'start' : 'update',
            'content-state': push.activity,
            'stale-date': Math.floor(push.issuedAt / 1000) + 15 * 60,
            'relevance-score': push.activity.phase === 'needs-you' ? 100 : 50,
            ...(done ? { 'dismissal-date': Math.floor(push.issuedAt / 1000) + 15 * 60 } : {}),
            ...(startsActivity && !done
                ? {
                      'attributes-type': 'RuimteActivityAttributes',
                      'input-push-token': 1,
                      attributes: { machineId: push.machineId, collapseId: push.collapseId },
                      alert: { title: 'Ruimte', body: push.activity.title }
                  }
                : {})
        }
    };
};

export const deliverApns = async (env: Env, target: ApnsTarget, push: PushEnvelope, now: number, send: typeof fetch = fetch): Promise<ApnsResult> => {
    const body = JSON.stringify(apnsPayload(push, target.startsActivity));
    if (new TextEncoder().encode(body).byteLength > 4096) {
        return { ok: false, status: 413 };
    }
    if (!apnsConfigured(env, target.environment)) {
        return { ok: false, status: 503 };
    }
    const host = target.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const response = await send(`https://${host}/3/device/${target.token}`, {
        method: 'POST',
        headers: {
            authorization: `bearer ${await providerToken(env, target.environment, now)}`,
            'apns-topic': push.pushType === 'liveactivity' ? `${env.APNS_TOPIC}.push-type.liveactivity` : env.APNS_TOPIC!,
            'apns-push-type': push.pushType,
            'apns-priority': push.pushType === 'alert' || target.startsActivity ? '10' : '5',
            'apns-expiration': String(Math.floor(push.expiresAt / 1000)),
            'apns-collapse-id': push.collapseId,
            'content-type': 'application/json'
        },
        body
    });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status };
};
