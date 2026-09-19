import {
    MACHINE_ACTIVITY_NODE,
    PUSH_MAX_AGE_MS,
    PUSH_MAX_CLOCK_SKEW_MS,
    PushActivityRegistrationSchema,
    PushEnvelopeSchema,
    PushHandleSchema,
    PushRegisterDevicePayloadSchema,
    PushStartActivityRegistrationSchema,
    pushCollapseIdMessage,
    pushMessage,
    randomToken,
    type PushEnvelope
} from '@ruimte/pulsar';
import { apnsConfigured, invalidApnsToken, deliverApns, type ApnsResult } from './apns.ts';
import { verifyEd25519 } from './crypto.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, noContent, readBody } from './http.ts';
import { overLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

export const registerPushDevice = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return failure('unauthorized', 'Sign in again');
    }
    const limited = await overLimit(env.DB, `push-register:${session.id}`, 20);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, PushRegisterDevicePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    if (!apnsConfigured(env, body.value.environment)) {
        return failure('not-configured', 'Push notifications are not configured');
    }
    const row = await env.DB.prepare(
        `INSERT INTO push_device (handle, account_id, session_id, token, environment, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(session_id, environment) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at
        RETURNING handle`
    )
        .bind(randomToken(), session.account.id, session.id, body.value.token.toLowerCase(), body.value.environment, Date.now())
        .first<{ handle: string }>();
    return json({ handle: row!.handle });
};

interface ActivitySelection {
    activity_scope: string | null;
    start_machine_id: string | null;
    start_collapse_id: string | null;
}

const selectsActivity = async (device: ActivitySelection, machineId: string, collapseId: string): Promise<boolean> => {
    if (device.activity_scope === 'machines') {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pushCollapseIdMessage(machineId, MACHINE_ACTIVITY_NODE)));
        const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '');
        return collapseId === expected;
    }
    return device.start_machine_id === machineId && device.start_collapse_id === collapseId;
};

export const changePushDevice = async (
    request: Request,
    env: Env,
    handle: string,
    activity: 'update' | 'start' | null,
    send: typeof deliverApns = deliverApns
): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return failure('unauthorized', 'Sign in again');
    }
    if (!PushHandleSchema.safeParse(handle).success) {
        return failure('bad-request', 'Invalid push handle');
    }
    const owned = await env.DB.prepare('SELECT handle FROM push_device WHERE handle = ?1 AND session_id = ?2 AND account_id = ?3')
        .bind(handle, session.id, session.account.id)
        .first();
    if (!owned) {
        return failure('not-found', 'No push device for this session');
    }
    const limited = await overLimit(env.DB, `push-device:${session.id}`, 60);
    if (limited) {
        return limited;
    }
    if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM push_device WHERE handle = ?1 AND session_id = ?2').bind(handle, session.id).run();
        return noContent();
    }
    if (activity === 'start') {
        const body = await readBody(request, PushStartActivityRegistrationSchema);
        if ('response' in body) {
            return body.response;
        }
        const { machineId, collapseId, scope } = body.value;
        if ((machineId == null) !== (collapseId == null)) {
            return failure('bad-request', 'An activity needs a machine and conversation');
        }
        if (machineId && !(await env.DB.prepare('SELECT id FROM machine WHERE id = ?1 AND account_id = ?2').bind(machineId, session.account.id).first())) {
            return failure('not-found', 'No machine on this account');
        }
        await env.DB.prepare(
            'UPDATE push_device SET start_token = ?1, start_machine_id = ?4, start_collapse_id = ?5, activity_scope = ?6 WHERE handle = ?2 AND session_id = ?3'
        )
            .bind(body.value.token?.toLowerCase() ?? null, handle, session.id, machineId ?? null, collapseId ?? null, scope ?? null)
            .run();
    } else {
        const body = await readBody(request, PushActivityRegistrationSchema);
        if ('response' in body) {
            return body.response;
        }
        const machine = await env.DB.prepare('SELECT id FROM machine WHERE id = ?1 AND account_id = ?2').bind(body.value.machineId, session.account.id).first();
        if (!machine) {
            return failure('not-found', 'No machine on this account');
        }
        if (body.value.reserve || body.value.token !== null) {
            const selected = await env.DB.prepare('SELECT activity_scope, start_machine_id, start_collapse_id FROM push_device WHERE handle = ?1')
                .bind(handle)
                .first<ActivitySelection>();
            if (!selected || !(await selectsActivity(selected, body.value.machineId, body.value.collapseId))) {
                return failure('not-found', 'This conversation is not selected for Live Activities');
            }
        }
        if (body.value.reserve) {
            const now = Date.now();
            const claim = await env.DB.prepare(
                `INSERT INTO push_activity_start (handle, machine_id, collapse_id, expires_at, started_at) VALUES (?1, ?2, ?3, ?4, ?6)
                ON CONFLICT(handle, machine_id, collapse_id) DO UPDATE SET expires_at = excluded.expires_at, pending_push = NULL, started_at = excluded.started_at
                WHERE push_activity_start.expires_at <= ?5 OR push_activity_start.expires_at > excluded.expires_at + 300000`
            )
                .bind(handle, body.value.machineId, body.value.collapseId, now + PUSH_MAX_AGE_MS, now, body.value.startedAt ?? null)
                .run();
            return json({ reserved: claim.meta.changes > 0 });
        }
        if (body.value.token === null) {
            await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND started_at IS ?4')
                .bind(handle, body.value.collapseId, body.value.machineId, body.value.startedAt ?? null)
                .run();
            if (body.value.release) {
                await env.DB.prepare('DELETE FROM push_activity_start WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND started_at IS ?4')
                    .bind(handle, body.value.collapseId, body.value.machineId, body.value.startedAt ?? null)
                    .run();
            }
        } else {
            // A delayed callback from an ended activity must not replace the current round's token.
            const registered = await env.DB.prepare(
                `INSERT INTO push_activity (handle, collapse_id, token, updated_at, machine_id, started_at)
                SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE
                    (?6 IS NULL AND NOT EXISTS (SELECT 1 FROM push_activity_start WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?5 AND started_at IS NOT NULL))
                    OR EXISTS (SELECT 1 FROM push_activity_start WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?5 AND started_at = ?6)
                ON CONFLICT(handle, machine_id, collapse_id) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at, started_at = excluded.started_at
                WHERE push_activity.started_at IS NULL OR excluded.started_at >= push_activity.started_at`
            )
                .bind(handle, body.value.collapseId, body.value.token.toLowerCase(), Date.now(), body.value.machineId, body.value.startedAt ?? null)
                .run();
            if (registered.meta.changes === 0) {
                return noContent();
            }
            const pending = await env.DB.prepare(
                'SELECT pending_push FROM push_activity_start WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND started_at IS ?4'
            )
                .bind(handle, body.value.machineId, body.value.collapseId, body.value.startedAt ?? null)
                .first<{ pending_push: string | null }>();
            if (pending?.pending_push) {
                const parsed = PushEnvelopeSchema.safeParse(JSON.parse(pending.pending_push));
                const device = await env.DB.prepare('SELECT environment FROM push_device WHERE handle = ?1')
                    .bind(handle)
                    .first<{ environment: 'sandbox' | 'production' }>();
                if (parsed.success && parsed.data.pushType === 'liveactivity' && device) {
                    // A push-to-start can finish before iOS has supplied its update token.
                    const result = await send(
                        env,
                        { token: body.value.token.toLowerCase(), environment: device.environment, startsActivity: false },
                        parsed.data,
                        Date.now()
                    );
                    if (result.ok) {
                        if (parsed.data.activity.phase === 'done') {
                            await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND token = ?4')
                                .bind(handle, body.value.machineId, body.value.collapseId, body.value.token.toLowerCase())
                                .run();
                            await env.DB.prepare(
                                'DELETE FROM push_activity_start WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND pending_push = ?4'
                            )
                                .bind(handle, body.value.machineId, body.value.collapseId, pending.pending_push)
                                .run();
                        } else {
                            await env.DB.prepare(
                                'UPDATE push_activity_start SET pending_push = NULL WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND pending_push = ?4'
                            )
                                .bind(handle, body.value.machineId, body.value.collapseId, pending.pending_push)
                                .run();
                        }
                    } else {
                        return failure('internal', 'The activity update could not be delivered');
                    }
                }
            }
        }
    }
    return noContent();
};

interface DeliveryTarget {
    token: string;
    environment: 'sandbox' | 'production';
    startsActivity: boolean;
}
export interface PushDeliverySeams {
    now(): number;
    send(env: Env, target: DeliveryTarget, push: PushEnvelope, now: number): Promise<ApnsResult>;
}
const SYSTEM_PUSH: PushDeliverySeams = { now: Date.now, send: deliverApns };

const claimActivityStart = async (env: Env, push: Extract<PushEnvelope, { pushType: 'liveactivity' }>, now: number, automatic: boolean): Promise<boolean> => {
    // Unconfirmed starts expire with the APNs message. Reclaim legacy eight-hour leases too.
    const claim = await env.DB.prepare(
        `INSERT INTO push_activity_start (handle, collapse_id, expires_at, machine_id, started_at) VALUES (?1, ?2, ?3, ?5, ?6)
        ON CONFLICT(handle, machine_id, collapse_id) DO UPDATE SET expires_at = excluded.expires_at, pending_push = NULL, started_at = excluded.started_at
        WHERE (push_activity_start.started_at IS NULL AND excluded.started_at IS NOT NULL) OR push_activity_start.started_at < excluded.started_at
            OR (push_activity_start.started_at IS excluded.started_at AND
                (push_activity_start.expires_at <= ?4 OR push_activity_start.expires_at > excluded.expires_at + 300000))`
    )
        .bind(push.handle, push.collapseId, now + PUSH_MAX_AGE_MS, now, push.machineId, automatic ? push.activity.startedAt : null)
        .run();
    return claim.meta.changes > 0;
};

export const sendPush = async (request: Request, env: Env, seams: PushDeliverySeams = SYSTEM_PUSH): Promise<Response> => {
    const now = seams.now();
    const ipLimit = await overLimit(env.DB, `push-ip:${clientIp(request)}`, 240, now);
    if (ipLimit) {
        return ipLimit;
    }
    const body = await readBody(request, PushEnvelopeSchema);
    if ('response' in body) {
        return body.response;
    }
    const push = body.value;
    if (
        push.issuedAt > now + PUSH_MAX_CLOCK_SKEW_MS ||
        push.issuedAt < now - PUSH_MAX_AGE_MS ||
        push.expiresAt <= now ||
        push.expiresAt <= push.issuedAt ||
        push.expiresAt - push.issuedAt > PUSH_MAX_AGE_MS
    ) {
        return failure('bad-request', 'The notification has expired or the machine clock is off');
    }
    // Access-token expiry does not end a device; revoked or expired account sessions do.
    const device = await env.DB.prepare(
        `SELECT device.token, device.environment, device.start_token, device.start_machine_id, device.start_collapse_id, device.activity_scope, machine.public_key
        FROM push_device AS device JOIN session ON session.id = device.session_id AND session.account_id = device.account_id
        JOIN machine ON machine.account_id = device.account_id AND machine.id = ?1
        WHERE device.handle = ?2 AND session.revoked_at IS NULL AND session.expires_at > ?3`
    )
        .bind(push.machineId, push.handle, now)
        .first<{
            token: string;
            environment: 'sandbox' | 'production';
            start_token: string | null;
            activity_scope: string | null;
            start_machine_id: string | null;
            start_collapse_id: string | null;
            public_key: string;
        }>();
    if (!device) {
        return failure('unauthorized', 'The machine and active device must belong to the same account');
    }
    if (!(await verifyEd25519(device.public_key, pushMessage(push), push.signature))) {
        return failure('bad-signature', 'The machine did not sign this notification');
    }
    for (const [bucket, limit] of [
        [`push-machine:${device.public_key}`, 120],
        [`push-handle:${push.handle}`, 60]
    ] as const) {
        const limited = await overLimit(env.DB, bucket, limit, now);
        if (limited) {
            return limited;
        }
    }
    if (!apnsConfigured(env, device.environment)) {
        return failure('not-configured', 'Push notifications are not configured');
    }
    let token = device.token;
    let startsActivity = false;
    let endsUnregisteredActivity = false;
    if (push.pushType === 'liveactivity') {
        if (!(await selectsActivity(device, push.machineId, push.collapseId))) {
            return failure('not-found', 'This conversation is not selected for Live Activities');
        }
        let activity = await env.DB.prepare('SELECT token, started_at FROM push_activity WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3')
            .bind(push.handle, push.collapseId, push.machineId)
            .first<{ token: string; started_at: number | null }>();
        if (activity && (activity.started_at !== null || device.activity_scope === 'machines') && activity.started_at !== push.activity.startedAt) {
            if (activity.started_at !== null && activity.started_at > push.activity.startedAt) {
                return noContent();
            }
            await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND token = ?4 AND started_at IS ?5')
                .bind(push.handle, push.collapseId, push.machineId, activity.token, activity.started_at)
                .run();
            activity = null;
        }
        token = activity?.token ?? device.start_token ?? '';
        startsActivity = !activity;
        endsUnregisteredActivity = startsActivity && push.activity.phase === 'done';
        if (!token && !endsUnregisteredActivity) {
            return failure('not-found', 'No activity token for this notification');
        }
    }
    // Atomic claim before APNs: concurrent replays must never deliver twice, including across isolates.
    const receipt = await env.DB.prepare('INSERT OR IGNORE INTO push_receipt (handle, id, expires_at) VALUES (?1, ?2, ?3)')
        .bind(push.handle, push.id, push.expiresAt)
        .run();
    if (receipt.meta.changes === 0) {
        return failure('bad-request', 'This notification was already submitted');
    }
    if (endsUnregisteredActivity && push.pushType === 'liveactivity') {
        await env.DB.prepare(
            'UPDATE push_activity_start SET pending_push = ?4 WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND (started_at IS NULL OR started_at = ?5)'
        )
            .bind(push.handle, push.collapseId, push.machineId, JSON.stringify(push), push.activity.startedAt)
            .run();
        return noContent();
    }
    if (startsActivity && push.pushType === 'liveactivity') {
        if (!(await claimActivityStart(env, push, now, device.activity_scope === 'machines'))) {
            await env.DB.prepare(
                'UPDATE push_activity_start SET pending_push = ?4 WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND (started_at IS NULL OR started_at = ?5)'
            )
                .bind(push.handle, push.collapseId, push.machineId, JSON.stringify(push), push.activity.startedAt)
                .run();
            return noContent();
        }
    }
    let result: ApnsResult;
    try {
        result = await seams.send(env, { token, environment: device.environment, startsActivity }, push, now);
    } catch {
        result = { ok: false, status: 502 };
    }
    if (!startsActivity && push.pushType === 'liveactivity' && invalidApnsToken(result)) {
        const removed = await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND token = ?4')
            .bind(push.handle, push.machineId, push.collapseId, token)
            .run();
        if (removed.meta.changes > 0) {
            await env.DB.prepare(
                'DELETE FROM push_activity_start WHERE handle = ?1 AND machine_id = ?2 AND collapse_id = ?3 AND (started_at IS NULL OR started_at = ?4)'
            )
                .bind(push.handle, push.machineId, push.collapseId, push.activity.startedAt)
                .run();
            if (push.activity.phase === 'done') {
                return noContent();
            }
            if (device.start_token && (await claimActivityStart(env, push, now, device.activity_scope === 'machines'))) {
                token = device.start_token;
                startsActivity = true;
                try {
                    result = await seams.send(env, { token, environment: device.environment, startsActivity }, push, now);
                } catch {
                    result = { ok: false, status: 502 };
                }
            }
        }
    }
    if (startsActivity && !result.ok && push.pushType === 'liveactivity') {
        await env.DB.prepare(
            'DELETE FROM push_activity_start WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND (started_at IS NULL OR started_at = ?4)'
        )
            .bind(push.handle, push.collapseId, push.machineId, push.activity.startedAt)
            .run();
    }
    if (result.ok && push.pushType === 'liveactivity' && push.activity.phase === 'done') {
        await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND collapse_id = ?2 AND token = ?3 AND machine_id = ?4')
            .bind(push.handle, push.collapseId, token, push.machineId)
            .run();
        await env.DB.prepare(
            'DELETE FROM push_activity_start WHERE handle = ?1 AND collapse_id = ?2 AND machine_id = ?3 AND (started_at IS NULL OR started_at = ?4)'
        )
            .bind(push.handle, push.collapseId, push.machineId, push.activity.startedAt)
            .run();
    }
    if (invalidApnsToken(result)) {
        if (push.pushType !== 'liveactivity') {
            await env.DB.prepare('DELETE FROM push_device WHERE handle = ?1 AND token = ?2').bind(push.handle, token).run();
        } else if (startsActivity) {
            await env.DB.prepare('UPDATE push_device SET start_token = NULL WHERE handle = ?1 AND start_token = ?2').bind(push.handle, token).run();
        } else {
            await env.DB.prepare('DELETE FROM push_activity WHERE handle = ?1 AND collapse_id = ?2 AND token = ?3 AND machine_id = ?4')
                .bind(push.handle, push.collapseId, token, push.machineId)
                .run();
        }
    }
    if (!result.ok) {
        return failure(result.status === 413 ? 'bad-request' : 'internal', 'The notification could not be delivered');
    }
    return noContent();
};
