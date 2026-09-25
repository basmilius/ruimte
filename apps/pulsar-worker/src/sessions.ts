import {
    SESSION_REFRESH_MAX_SKEW_MS,
    randomToken,
    sessionRefreshMessage,
    sha256,
    type ProviderId,
    type SessionRefreshPayload,
    type SessionResult
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';

// Short enough that a leaked access token is worth little; the refresh token is what a device keeps.
export const ACCESS_LIFETIME_MS = 15 * 60_000;
// Counted from sign-in, never extended, so a lost device falls out on its own.
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;

/*
 * The identity an account is shown as, as SQL over the account id `ref` names: the oldest with a login,
 * else the oldest. An account with no identity row is one a Worker from before identities made while the
 * migration had already run, and falls back to what that Worker wrote on the account itself.
 */
const DISPLAY_IDENTITY = (ref: string, column: 'provider' | 'login'): string =>
    `(SELECT identity.${column} FROM identity WHERE identity.account_id = ${ref} ORDER BY identity.login IS NULL, identity.created_at, identity.provider LIMIT 1)`;

export const accountProviderSql = (ref: string): string =>
    `COALESCE(${DISPLAY_IDENTITY(ref, 'provider')}, (SELECT account.provider FROM account WHERE account.id = ${ref}))`;

export const accountLoginSql = (ref: string): string =>
    `CASE WHEN EXISTS (SELECT 1 FROM identity WHERE identity.account_id = ${ref}) THEN ${DISPLAY_IDENTITY(ref, 'login')} ELSE (SELECT account.login FROM account WHERE account.id = ${ref}) END`;

/*
 * The first name in the order `DISPLAY_IDENTITY` picks the identity in, so the name of the identity the
 * account is shown as wins, and another identity's name stands in when that one has none.
 */
export const accountDisplayNameSql = (ref: string): string =>
    `(SELECT identity.display_name FROM identity WHERE identity.account_id = ${ref} ORDER BY identity.display_name IS NULL, identity.login IS NULL, identity.created_at, identity.provider LIMIT 1)`;

export interface AccountRow {
    id: string;
    provider: ProviderId;
    login: string | null;
    displayName: string | null;
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
 * Refresh tokens rotate once. Reuse revokes the session, but only after the session key verifies, so
 * a stolen token without its private key cannot refresh or revoke the legitimate device.
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
    if (!(await verifySignature(session.session_key, sessionRefreshMessage(payload.refreshToken, payload.issuedAt), payload.signature))) {
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
                 ${accountProviderSql('session.account_id')} AS provider,
                 ${accountLoginSql('session.account_id')} AS login,
                 ${accountDisplayNameSql('session.account_id')} AS display_name`
        )
        .bind(await sha256(accessToken), accessExpiresAt, await sha256(nextRefreshToken), session.id, hash)
        .first<{ expires_at: number; account_id: string; provider: ProviderId; login: string | null; display_name: string | null }>();
    if (!row) {
        await revokeSession(db, session.id);
        return null;
    }
    return {
        accessToken,
        accessExpiresAt,
        refreshToken: nextRefreshToken,
        expiresAt: row.expires_at,
        account: { id: row.account_id, provider: row.provider, login: row.login, displayName: row.display_name }
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
            `SELECT session.id, session.label, account.id AS account_id, ${accountProviderSql('account.id')} AS provider, ${accountLoginSql('account.id')} AS login,
                 ${accountDisplayNameSql('account.id')} AS display_name
             FROM session JOIN account ON account.id = session.account_id
             WHERE session.access_hash = ?1 AND session.revoked_at IS NULL AND session.access_expires_at > ?2 AND session.expires_at > ?2`
        )
        .bind(await sha256(match[1]), now)
        .first<{ id: string; label: string | null; account_id: string; provider: ProviderId; login: string | null; display_name: string | null }>();
    if (!row) {
        return null;
    }
    return { id: row.id, label: row.label, account: { id: row.account_id, provider: row.provider, login: row.login, displayName: row.display_name } };
};

export const revokeSession = async (db: D1Database, sessionId: string): Promise<void> => {
    await db.prepare('UPDATE session SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL').bind(Date.now(), sessionId).run();
};
