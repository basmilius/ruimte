import {
    DEVICE_LINK_COMPLETE_GRACE_MS,
    DEVICE_LINK_LIFETIME_MS,
    DEVICE_LINK_PAGE_URL,
    DEVICE_LINK_POLL_INTERVAL_S,
    DeviceCodePayloadSchema,
    DeviceLinkCompletePayloadSchema,
    DeviceLinkStartPayloadSchema,
    MACHINE_REGISTRATION_MAX_SKEW_MS,
    UserCodePayloadSchema,
    deviceLinkStartMessage,
    formatUserCode,
    generateUserCode,
    machineRegistrationMessage,
    normalizeUserCode,
    randomToken,
    sha256,
    type Account,
    type DeviceLinkLookupResult,
    type DeviceLinkPollResult,
    type DeviceLinkStartResult,
    type DeviceLinkStatus,
    type MachineIcon,
    type ProviderId
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import type { Env } from './env.ts';
import { clientIp, failure, json, noContent, readBody } from './http.ts';
import { storeMachine } from './machines.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { accountLoginSql, accountProviderSql, authenticate, type SessionContext } from './sessions.ts';

/*
 * Linking a machine with a code (`ruimte login`). The terminal starts a link and holds the device
 * code; a signed-in person approves the short user code on the web client; the terminal sees the
 * account on its next poll, has the machine sign an ordinary registration for exactly that account,
 * and hands it in with the device code. No session and no token ever reaches the machine.
 */

type StoredStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'done';

interface LinkRow {
    machine_id: string;
    name: string;
    icon: string | null;
    broker_url: string | null;
    public_key: string;
    status: StoredStatus;
    account_id: string | null;
    expires_at: number;
}

const LINK_COLUMNS = 'machine_id, name, icon, broker_url, public_key, status, account_id, expires_at';

const iconOf = (row: LinkRow): MachineIcon | null => (row.icon ? (JSON.parse(row.icon) as MachineIcon) : null);

const lookupResult = (row: LinkRow): DeviceLinkLookupResult => ({
    machine: { id: row.machine_id, name: row.name, icon: iconOf(row), publicKey: row.public_key },
    expiresAt: row.expires_at
});

const pageUrl = (env: Env): string => env.DEVICE_LINK_PAGE_URL ?? DEVICE_LINK_PAGE_URL;

// A code that does not exist, ran out or was used already all read the same, so a guess learns nothing from which.
const noSuchCode = (): Response => failure('not-found', 'No machine waits for that code. It may have expired or been used; run `ruimte login` again.');

// `POST /v1/device/start`, without a session.
export const startDeviceLink = async (request: Request, env: Env): Promise<Response> => {
    const ip = clientIp(request);
    const limited = await overAnyLimit(env.DB, [[`ip:${ip}:device-start`, LIMITS.deviceStartIp]]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, DeviceLinkStartPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const payload = body.value;
    const now = Date.now();
    if (Math.abs(now - payload.issuedAt) > MACHINE_REGISTRATION_MAX_SKEW_MS) {
        return failure('bad-request', 'The request was signed too long ago, or the machine clock is off');
    }
    if (!(await verifySignature(payload.publicKey, deviceLinkStartMessage(payload.id, payload.publicKey, payload.name, payload.issuedAt), payload.signature))) {
        return failure('bad-signature', 'The machine did not sign this request');
    }
    const deviceCode = randomToken();
    const expiresAt = now + DEVICE_LINK_LIFETIME_MS;
    // Two live links never share a code; with a handful of links at a time a clash is rare, and a second draw ends it.
    for (let attempt = 0; attempt < 5; attempt++) {
        const userCode = generateUserCode();
        const inserted = await env.DB.prepare(
            `INSERT INTO device_link (device_code_hash, user_code, machine_id, name, icon, broker_url, public_key, status, ip, created_at, expires_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10
             WHERE NOT EXISTS (SELECT 1 FROM device_link WHERE user_code = ?2 AND status IN ('pending', 'approved') AND expires_at > ?9)`
        )
            .bind(
                await sha256(deviceCode),
                userCode,
                payload.id,
                payload.name,
                payload.icon ? JSON.stringify(payload.icon) : null,
                payload.brokerUrl,
                payload.publicKey,
                ip,
                now,
                expiresAt
            )
            .run();
        if (inserted.meta.changes === 1) {
            const verificationUri = pageUrl(env);
            const complete = new URL(verificationUri);
            complete.searchParams.set('code', formatUserCode(userCode));
            const result: DeviceLinkStartResult = {
                deviceCode,
                userCode: formatUserCode(userCode),
                verificationUri,
                verificationUriComplete: complete.toString(),
                expiresAt,
                interval: DEVICE_LINK_POLL_INTERVAL_S
            };
            return json(result);
        }
    }
    return failure('internal', 'No free code could be found; try again');
};

// The session and the code for the three routes a person uses, or the response that says why not.
const personAndCode = async (request: Request, env: Env): Promise<{ session: SessionContext; userCode: string } | { response: Response }> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return { response: failure('unauthorized', 'Sign in again') };
    }
    // Counted before the code is read, so every guess costs, a malformed one included.
    const limited = await overAnyLimit(env.DB, [
        [`account:${session.account.id}:device-code`, LIMITS.deviceCodeAccount],
        [`ip:${clientIp(request)}:device-code`, LIMITS.deviceCodeIp]
    ]);
    if (limited) {
        return { response: limited };
    }
    const body = await readBody(request, UserCodePayloadSchema);
    if ('response' in body) {
        return body;
    }
    const userCode = normalizeUserCode(body.value.userCode);
    if (userCode === null) {
        return { response: noSuchCode() };
    }
    return { session, userCode };
};

// `POST /v1/device/lookup`: what the approval page shows. Reading it spends nothing.
export const lookupDeviceLink = async (request: Request, env: Env): Promise<Response> => {
    const given = await personAndCode(request, env);
    if ('response' in given) {
        return given.response;
    }
    const row = await env.DB.prepare(`SELECT ${LINK_COLUMNS} FROM device_link WHERE user_code = ?1 AND status = 'pending' AND expires_at > ?2`)
        .bind(given.userCode, Date.now())
        .first<LinkRow>();
    return row ? json(lookupResult(row)) : noSuchCode();
};

/*
 * `POST /v1/device/approve` and `/deny`. One conditional update, so a code is decided once however
 * many pages press at the same moment. An approval leaves the terminal time to finish even when it
 * came in the last seconds of the code.
 */
const decide = async (request: Request, env: Env, decision: 'approved' | 'denied'): Promise<Response> => {
    const given = await personAndCode(request, env);
    if ('response' in given) {
        return given.response;
    }
    const now = Date.now();
    const row = await env.DB.prepare(
        `UPDATE device_link SET status = ?1, account_id = ?2, decided_at = ?3, expires_at = MAX(expires_at, ?4)
         WHERE user_code = ?5 AND status = 'pending' AND expires_at > ?3
         RETURNING ${LINK_COLUMNS}`
    )
        .bind(decision, given.session.account.id, now, decision === 'approved' ? now + DEVICE_LINK_COMPLETE_GRACE_MS : 0, given.userCode)
        .first<LinkRow>();
    if (!row) {
        return noSuchCode();
    }
    return decision === 'approved' ? json(lookupResult(row)) : noContent();
};

export const approveDeviceLink = (request: Request, env: Env): Promise<Response> => decide(request, env, 'approved');

export const denyDeviceLink = (request: Request, env: Env): Promise<Response> => decide(request, env, 'denied');

// The link a device code names, with the account that decided it; a used link is gone for the terminal.
const linkOfDeviceCode = async (env: Env, deviceCode: string) =>
    env.DB.prepare(
        `SELECT ${LINK_COLUMNS.split(', ')
            .map((column) => `device_link.${column}`)
            .join(', ')}, CASE WHEN account.id IS NULL THEN NULL ELSE ${accountProviderSql('account.id')} END AS provider,
             CASE WHEN account.id IS NULL THEN NULL ELSE ${accountLoginSql('account.id')} END AS login
         FROM device_link LEFT JOIN account ON account.id = device_link.account_id
         WHERE device_link.device_code_hash = ?1 AND device_link.status != 'done'`
    )
        .bind(await sha256(deviceCode))
        .first<LinkRow & { provider: ProviderId | null; login: string | null }>();

const deviceCodeBody = async (request: Request, env: Env, bucket: string, limit: number) => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:${bucket}`, limit]]);
    if (limited) {
        return { response: limited };
    }
    return readBody(request, DeviceCodePayloadSchema);
};

// `POST /v1/device/poll`
export const pollDeviceLink = async (request: Request, env: Env): Promise<Response> => {
    const body = await deviceCodeBody(request, env, 'device-poll', LIMITS.devicePollIp);
    if ('response' in body) {
        return body.response;
    }
    const row = await linkOfDeviceCode(env, body.value.deviceCode);
    if (!row) {
        return failure('not-found', 'No such link; it expired or was used');
    }
    const decided = row.status === 'denied' || row.status === 'cancelled';
    // A denial or a cancel is said as such until the cleanup; only a link still waiting runs out.
    const status: DeviceLinkStatus = decided ? (row.status as DeviceLinkStatus) : row.expires_at <= Date.now() ? 'expired' : (row.status as DeviceLinkStatus);
    const account: Account | null =
        status === 'approved' && row.account_id !== null && row.provider !== null ? { id: row.account_id, provider: row.provider, login: row.login } : null;
    const result: DeviceLinkPollResult = { status, interval: DEVICE_LINK_POLL_INTERVAL_S, account };
    return json(result);
};

/*
 * `POST /v1/device/complete`: the registration for the account that approved, signed by the machine.
 * The link is spent before the machine is stored, so a device code registers once even when two
 * requests race; one that fails after that is started again from the terminal.
 */
export const completeDeviceLink = async (request: Request, env: Env): Promise<Response> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:device-poll`, LIMITS.devicePollIp]]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, DeviceLinkCompletePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const payload = body.value;
    const now = Date.now();
    const row = await linkOfDeviceCode(env, payload.deviceCode);
    if (!row || row.status !== 'approved' || row.expires_at <= now || row.account_id === null || row.provider === null) {
        return failure('not-found', 'No approved link for that code; it expired, was used, or nobody approved it yet');
    }
    if (Math.abs(now - payload.issuedAt) > MACHINE_REGISTRATION_MAX_SKEW_MS) {
        return failure('bad-request', 'The registration was signed too long ago, or the machine clock is off');
    }
    const message = machineRegistrationMessage(row.account_id, row.machine_id, row.public_key, row.name, payload.issuedAt);
    if (!(await verifySignature(row.public_key, message, payload.signature))) {
        return failure('bad-signature', 'The machine did not sign this registration for the account that approved it');
    }
    const spent = await env.DB.prepare(`UPDATE device_link SET status = 'done' WHERE device_code_hash = ?1 AND status = 'approved' RETURNING 1 AS spent`)
        .bind(await sha256(payload.deviceCode))
        .first<{ spent: number }>();
    if (!spent) {
        return failure('not-found', 'That link was used already');
    }
    const stored = await storeMachine(
        env.DB,
        row.account_id,
        { id: row.machine_id, name: row.name, icon: iconOf(row), brokerUrl: row.broker_url, publicKey: row.public_key },
        true,
        now
    );
    if ('response' in stored) {
        return stored.response;
    }
    return json({ machine: stored.machine, account: { id: row.account_id, provider: row.provider, login: row.login } });
};

// `POST /v1/device/cancel`: the terminal stopped waiting, so the code stops working on the page too.
export const cancelDeviceLink = async (request: Request, env: Env): Promise<Response> => {
    const body = await deviceCodeBody(request, env, 'device-poll', LIMITS.devicePollIp);
    if ('response' in body) {
        return body.response;
    }
    await env.DB.prepare(`UPDATE device_link SET status = 'cancelled' WHERE device_code_hash = ?1 AND status IN ('pending', 'approved')`)
        .bind(await sha256(body.value.deviceCode))
        .run();
    return noContent();
};
