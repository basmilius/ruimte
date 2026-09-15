import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BrokerRole, IceServer } from '@ruimte/pulsar';

/* The servers a key may use and when their credentials stop working, epoch ms; null when nothing expires. */
export interface IceGrant {
    servers: IceServer[];
    expiresAt: number | null;
}

export interface TurnPeer {
    role: BrokerRole;
    publicKey: string;
}

/*
 * Where TURN credentials come from. The broker is the one place that hands them out, because it is
 * the one place that already knows a key proved itself; what stands behind it (a coturn on the same
 * host, Cloudflare's service, nothing) is this seam.
 */
export interface TurnProvider {
    iceServersFor(peer: TurnPeer): Promise<IceGrant>;
}

/* A broker without TURN: every peer gets no servers, and nothing changes for anyone. */
export const noTurn: TurnProvider = {
    iceServersFor: async () => ({ servers: [], expiresAt: null })
};

/*
 * The TURN REST credential coturn checks with `use-auth-secret`: the username is the expiry in unix
 * seconds and a label, the password the base64 HMAC-SHA1 of that username under the shared secret.
 * The label carries the role and the start of the key, so coturn's log says whose allocation it is.
 */
export const turnCredential = (secret: string, peer: TurnPeer, expiresAtSeconds: number): { username: string; credential: string } => {
    const username = `${expiresAtSeconds}:${peer.role === 'machine' ? 'm' : 'c'}-${peer.publicKey.slice(0, 16)}`;
    return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
};

export interface SharedSecretTurnOptions {
    /* A file holding the secret coturn has as `static-auth-secret`; read on every request, so a rotation needs no restart. */
    secretFile: string;
    /* `turn:` and `turns:` URLs, handed out in this order. */
    urls: string[];
    ttlSeconds: number;
    now?(): number;
    read?(path: string): Promise<string>;
}

export const sharedSecretTurn = (options: SharedSecretTurnOptions): TurnProvider => ({
    iceServersFor: async (peer) => {
        const secret = (await (options.read ?? ((path) => readFile(path, 'utf8')))(options.secretFile)).trim();
        if (secret === '') {
            throw new Error(`The TURN secret in ${options.secretFile} is empty`);
        }
        const expiresAtSeconds = Math.floor((options.now ?? Date.now)() / 1000) + options.ttlSeconds;
        return { servers: [{ urls: options.urls, ...turnCredential(secret, peer, expiresAtSeconds) }], expiresAt: expiresAtSeconds * 1000 };
    }
});

export interface CloudflareTurnOptions {
    keyId: string;
    /* A file holding the key's API token. */
    tokenFile: string;
    ttlSeconds: number;
    fetch?: typeof fetch;
    now?(): number;
    read?(path: string): Promise<string>;
}

// A request to Cloudflare that hangs must not hold a peer's answer past its own connect timeout.
const CLOUDFLARE_TIMEOUT_MS = 5_000;

const isIceServer = (value: unknown): value is IceServer =>
    typeof value === 'object' && value !== null && (typeof (value as IceServer).urls === 'string' || Array.isArray((value as IceServer).urls));

/*
 * Cloudflare's TURN service. Its credentials are not bound to a key, so one set serves every peer
 * until two thirds of its lifetime, which keeps the API calls to a handful a day however many peers ask.
 */
export const cloudflareTurn = (options: CloudflareTurnOptions): TurnProvider => {
    const now = options.now ?? Date.now;
    let cached: { grant: IceGrant; refreshAt: number } | null = null;
    let pending: Promise<IceGrant> | null = null;

    const generate = async (): Promise<IceGrant> => {
        const token = (await (options.read ?? ((path) => readFile(path, 'utf8')))(options.tokenFile)).trim();
        const issuedAt = now();
        const response = await (options.fetch ?? fetch)(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(options.keyId)}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ ttl: options.ttlSeconds }),
                signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS)
            }
        );
        if (!response.ok) {
            throw new Error(`Cloudflare answered ${response.status} for TURN credentials`);
        }
        const body = (await response.json()) as { iceServers?: unknown };
        // The API answers a list, and an older route one object; both are read.
        const listed = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
        const servers = listed.filter(isIceServer).slice(0, 8);
        if (servers.length === 0) {
            throw new Error('Cloudflare answered without ICE servers');
        }
        const grant = { servers, expiresAt: issuedAt + options.ttlSeconds * 1000 };
        cached = { grant, refreshAt: issuedAt + Math.floor((options.ttlSeconds * 1000 * 2) / 3) };
        return grant;
    };

    return {
        iceServersFor: async () => {
            if (cached !== null && now() < cached.refreshAt) {
                return cached.grant;
            }
            // Peers that ask together share the one request.
            pending ??= generate().finally(() => {
                pending = null;
            });
            return pending;
        }
    };
};
