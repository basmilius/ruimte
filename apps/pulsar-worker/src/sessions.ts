import {
    SESSION_REFRESH_MAX_SKEW_MS,
    randomToken,
    sessionRefreshMessage,
    sha256,
    toBase64Url,
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
function DISPLAY_IDENTITY(ref: string, column: 'provider' | 'login'): string {
    return `(SELECT identity.${column} FROM identity WHERE identity.account_id = ${ref} ORDER BY identity.login IS NULL, identity.created_at, identity.provider LIMIT 1)`;
}

export function accountProviderSql(ref: string): string {
    return `COALESCE(${DISPLAY_IDENTITY(ref, 'provider')}, (SELECT account.provider FROM account WHERE account.id = ${ref}))`;
}

export function accountLoginSql(ref: string): string {
    return `CASE WHEN EXISTS (SELECT 1 FROM identity WHERE identity.account_id = ${ref}) THEN ${DISPLAY_IDENTITY(ref, 'login')} ELSE (SELECT account.login FROM account WHERE account.id = ${ref}) END`;
}

/*
 * The first name in the order `DISPLAY_IDENTITY` picks the identity in, so the name of the identity the
 * account is shown as wins, and another identity's name stands in when that one has none.
 */
export function accountDisplayNameSql(ref: string): string {
    return `(SELECT identity.display_name FROM identity WHERE identity.account_id = ${ref} ORDER BY identity.display_name IS NULL, identity.login IS NULL, identity.created_at, identity.provider LIMIT 1)`;
}

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

export async function createSession(db: D1Database, account: AccountRow, label: string | null, sessionKey: string): Promise<SessionResult> {
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
}

// How long a spent refresh token still gets its own rotation back, for an answer that got lost on its way.
export const ROTATION_GRACE_MS = 5 * 60_000;

/*
 * The pair a rotation hands out, derived from the refresh token it spends and a salt only the row
 * holds: a retry of that rotation gets the very same pair, and neither the token nor the database
 * alone yields it.
 */
async function rotationOf(spent: string, salt: string): Promise<{ accessToken: string; refreshToken: string }> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(spent), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const derive = async (purpose: string): Promise<string> =>
        toBase64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}\n${salt}`)));
    return { accessToken: await derive('access'), refreshToken: await derive('refresh') };
}

interface SessionRow {
    id: string;
    session_key: string | null;
    current: number;
    refresh_hash: string;
    access_expires_at: number;
    expires_at: number;
    rotated_at: number | null;
    rotation_salt: string | null;
    account_id: string;
    provider: ProviderId;
    login: string | null;
    display_name: string | null;
}

function sessionOf(db: D1Database, hash: string, now: number): Promise<SessionRow | null> {
    return db
        .prepare(
            `SELECT id, session_key, refresh_hash = ?1 AS current, refresh_hash, access_expires_at, expires_at, rotated_at, rotation_salt,
                 account_id, ${accountProviderSql('session.account_id')} AS provider, ${accountLoginSql('session.account_id')} AS login,
                 ${accountDisplayNameSql('session.account_id')} AS display_name
             FROM session
             WHERE (refresh_hash = ?1 OR previous_refresh_hash = ?1) AND revoked_at IS NULL AND expires_at > ?2`
        )
        .bind(hash, now)
        .first<SessionRow>();
}

/* The rotation that spent this token once more, while it is fresh and still the one the row holds; null otherwise. */
async function replayed(session: SessionRow, spent: string, now: number): Promise<SessionResult | null> {
    if (session.rotated_at === null || session.rotation_salt === null || now - session.rotated_at > ROTATION_GRACE_MS) {
        return null;
    }
    const again = await rotationOf(spent, session.rotation_salt);
    // A Worker from before the salt rotates without one, which leaves the salt of an earlier rotation behind.
    if ((await sha256(again.refreshToken)) !== session.refresh_hash) {
        return null;
    }
    return {
        ...again,
        accessExpiresAt: session.access_expires_at,
        expiresAt: session.expires_at,
        account: { id: session.account_id, provider: session.provider, login: session.login, displayName: session.display_name }
    };
}

/*
 * Refresh tokens rotate once. A token spent before comes back as the same rotation for a short
 * while, since the answer to the first may have been lost on the way; after that it is reuse and
 * revokes the session. Both only once the session key verifies, so a stolen token without its
 * private key cannot refresh or revoke the legitimate device. A clock too far off is said apart,
 * so the device keeps a session that is fine once its clock is right.
 */
export async function rotateSession(db: D1Database, payload: SessionRefreshPayload): Promise<SessionResult | 'clock-skew' | null> {
    const now = Date.now();
    if (Math.abs(now - payload.issuedAt) > SESSION_REFRESH_MAX_SKEW_MS) {
        return 'clock-skew';
    }
    const hash = await sha256(payload.refreshToken);
    const session = await sessionOf(db, hash, now);
    if (!session?.session_key) {
        return null;
    }
    if (!(await verifySignature(session.session_key, sessionRefreshMessage(payload.refreshToken, payload.issuedAt), payload.signature))) {
        return null;
    }
    if (session.current !== 1) {
        const again = await replayed(session, payload.refreshToken, now);
        if (!again) {
            await revokeSession(db, session.id);
        }
        return again;
    }
    const salt = randomToken();
    const { accessToken, refreshToken: nextRefreshToken } = await rotationOf(payload.refreshToken, salt);
    const accessExpiresAt = now + ACCESS_LIFETIME_MS;
    // Guarded on the hash again, so two refreshes that both read the row before either wrote rotate it once.
    const row = await db
        .prepare(
            `UPDATE session SET access_hash = ?1, access_expires_at = ?2, refresh_hash = ?3, previous_refresh_hash = refresh_hash, rotated_at = ?6, rotation_salt = ?7
             WHERE id = ?4 AND refresh_hash = ?5 AND revoked_at IS NULL
             RETURNING expires_at`
        )
        .bind(await sha256(accessToken), accessExpiresAt, await sha256(nextRefreshToken), session.id, hash, now, salt)
        .first<{ expires_at: number }>();
    if (!row) {
        // The other refresh rotated first, so this one gets that rotation.
        const winner = await sessionOf(db, hash, now);
        const again = winner && winner.current !== 1 ? await replayed(winner, payload.refreshToken, now) : null;
        if (!again) {
            await revokeSession(db, session.id);
        }
        return again;
    }
    return {
        accessToken,
        accessExpiresAt,
        refreshToken: nextRefreshToken,
        expiresAt: row.expires_at,
        account: { id: session.account_id, provider: session.provider, login: session.login, displayName: session.display_name }
    };
}

export async function authenticate(request: Request, db: D1Database): Promise<SessionContext | null> {
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
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
    await db.prepare('UPDATE session SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL').bind(Date.now(), sessionId).run();
}
