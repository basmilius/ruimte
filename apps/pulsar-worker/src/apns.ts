import type { PushEnvelope } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { signEs256Jwt } from './jwt.ts';

interface ApnsTarget {
    token: string;
    environment: 'sandbox' | 'production';
    startsActivity: boolean;
}
export interface ApnsResult {
    ok: boolean;
    status: number;
}

let cached: { secret: string; keyId: string; teamId: string; issuedAt: number; token: Promise<string> } | null = null;

const providerToken = (env: Env, now: number): Promise<string> => {
    const secret = env.APNS_KEY!;
    const keyId = env.APNS_KEY_ID!;
    const teamId = env.APNS_TEAM_ID!;
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
    cached = { secret, keyId, teamId, issuedAt: now, token };
    return token;
};

export const apnsConfigured = (env: Env): boolean => !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);

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
    const host = target.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const response = await send(`https://${host}/3/device/${target.token}`, {
        method: 'POST',
        headers: {
            authorization: `bearer ${await providerToken(env, now)}`,
            'apns-topic': push.pushType === 'liveactivity' ? `${env.APNS_TOPIC}.push-type.liveactivity` : env.APNS_TOPIC!,
            'apns-push-type': push.pushType,
            'apns-priority': push.pushType === 'alert' ? '10' : '5',
            'apns-expiration': String(Math.floor(push.expiresAt / 1000)),
            'apns-collapse-id': push.collapseId,
            'content-type': 'application/json'
        },
        body
    });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status };
};
