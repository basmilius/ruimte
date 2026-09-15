import { SESSION_REFRESH_MAX_SKEW_MS, sessionRefreshMessage, type ProviderId, type SessionRefreshPayload, type SessionResult } from '@ruimte/pulsar';
import { verifyEd25519 } from './crypto.ts';
import { randomToken, sha256 } from './encoding.ts';

// Short enough that a leaked access token is worth little; the refresh token is what a device keeps.
export const ACCESS_LIFETIME_MS = 15 * 60_000;
// Counted from sign-in, never extended, so a lost device falls out on its own.
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;

export interface AccountRow {
    id: string;
    provider: ProviderId;
    login: string | null;
}

export interface SessionContext {
    id: string;
    account: AccountRow;
    label: string | null;
}

export const createSession = async (db: D1Database, account: AccountRow, label: string | null, sessionKey: string): Promise<SessionResult> => {
    const now = Date.now();
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = now + ACCESS_LIFETIME_MS;
    const expiresAt = now + SESSION_LIFETIME_MS;
    await db
        .prepare(
            'INSERT INTO session (id, account_id, label, access_hash, access_expires_at, refresh_hash, expires_at, created_at, session_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
        )
        .bind(crypto.randomUUID(), account.id, label, await sha256(accessToken), accessExpiresAt, await sha256(refreshToken), expiresAt, now, sessionKey)
        .run();
    return { accessToken, accessExpiresAt, refreshToken, expiresAt, account };
};

/*
 * A refresh token is spent the moment it is used. One that was already spent means two holders of the
 * same token, so the whole session ends: the device signs in again, and so does whoever copied it. A
 * client that lost the answer to a refresh ends up there too, which is the price of noticing a copy.
 *
 * Every refresh is signed with the key the session was opened with, and nothing happens to a session
 * before that signature holds: a token copied without the key refreshes nothing, and cannot end the
 * session of the device it was copied from either. A session without a key is from before the binding
 * and is refused, so it signs in again rather than staying unbound.
 */
export const rotateSession = async (db: D1Database, payload: SessionRefreshPayload): Promise<SessionResult | null> => {
    const now = Date.now();
    if (Math.abs(now - payload.issuedAt) > SESSION_REFRESH_MAX_SKEW_MS) {
        return null;
    }
    const hash = await sha256(payload.refreshToken);
    const session = await db
        .prepare(
            `SELECT id, session_key, refresh_hash = ?1 AS current FROM session
             WHERE (refresh_hash = ?1 OR previous_refresh_hash = ?1) AND revoked_at IS NULL AND expires_at > ?2`
        )
        .bind(hash, now)
        .first<{ id: string; session_key: string | null; current: number }>();
    if (!session?.session_key) {
        return null;
    }
    if (!(await verifyEd25519(session.session_key, sessionRefreshMessage(payload.refreshToken, payload.issuedAt), payload.signature))) {
        return null;
    }
    if (session.current !== 1) {
        await revokeSession(db, session.id);
        return null;
    }
    const accessToken = randomToken();
    const nextRefreshToken = randomToken();
    const accessExpiresAt = now + ACCESS_LIFETIME_MS;
    // Guarded on the hash again, so two refreshes that both read the row before either wrote rotate it once.
    const row = await db
        .prepare(
            `UPDATE session SET access_hash = ?1, access_expires_at = ?2, refresh_hash = ?3, previous_refresh_hash = refresh_hash
             WHERE id = ?4 AND refresh_hash = ?5 AND revoked_at IS NULL
             RETURNING expires_at, (SELECT id FROM account WHERE account.id = session.account_id) AS account_id,
                 (SELECT provider FROM account WHERE account.id = session.account_id) AS provider,
                 (SELECT login FROM account WHERE account.id = session.account_id) AS login`
        )
        .bind(await sha256(accessToken), accessExpiresAt, await sha256(nextRefreshToken), session.id, hash)
        .first<{ expires_at: number; account_id: string; provider: ProviderId; login: string | null }>();
    if (!row) {
        await revokeSession(db, session.id);
        return null;
    }
    return {
        accessToken,
        accessExpiresAt,
        refreshToken: nextRefreshToken,
        expiresAt: row.expires_at,
        account: { id: row.account_id, provider: row.provider, login: row.login }
    };
};

export const authenticate = async (request: Request, db: D1Database): Promise<SessionContext | null> => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
        return null;
    }
    const now = Date.now();
    const row = await db
        .prepare(
            `SELECT session.id, session.label, account.id AS account_id, account.provider, account.login FROM session
             JOIN account ON account.id = session.account_id
             WHERE session.access_hash = ?1 AND session.revoked_at IS NULL AND session.access_expires_at > ?2 AND session.expires_at > ?2`
        )
        .bind(await sha256(match[1]), now)
        .first<{ id: string; label: string | null; account_id: string; provider: ProviderId; login: string | null }>();
    if (!row) {
        return null;
    }
    return { id: row.id, label: row.label, account: { id: row.account_id, provider: row.provider, login: row.login } };
};

export const revokeSession = async (db: D1Database, sessionId: string): Promise<void> => {
    await db.prepare('UPDATE session SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL').bind(Date.now(), sessionId).run();
};
