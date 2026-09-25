import {
    IdentityLinkCompletePayloadSchema,
    IdentityLinkStartPayloadSchema,
    PROVIDER_NAMES,
    ProviderIdSchema,
    randomToken,
    sha256,
    type AccountResult,
    type Identity,
    type ProviderId
} from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { clientIp, failure, json, readBody } from './http.ts';
import { PROVIDERS, type ProviderIdentity } from './providers.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { accountDisplayNameSql, accountLoginSql, accountProviderSql, authenticate, type AccountRow, type SessionContext } from './sessions.ts';

// The start URL is opened the moment the token comes back; a token nobody used by then is worth dropping.
export const LINK_REQUEST_LIFETIME_MS = 5 * 60_000;
// The app trades the code the moment the redirect lands, as with a login code.
const LINK_CODE_LIFETIME_MS = 60_000;

const signInAgain = (): Response => failure('unauthorized', 'Sign in again');

// What a person calls the identity in a sentence: a GitHub account, an Apple ID.
const identityNoun = (provider: ProviderId): string => (provider === 'apple' ? 'Apple ID' : `${PROVIDER_NAMES[provider]} account`);

const identityTaken = (provider: ProviderId): Response =>
    failure('identity-taken', `This ${identityNoun(provider)} already belongs to another Ruimte account, so it was not added. Accounts are never merged.`);

const providerLinked = (provider: ProviderId): Response =>
    failure('provider-linked', `This account already signs in with ${PROVIDER_NAMES[provider]}. Remove that one first to add another.`);

/*
 * The account an identity opens, made on its first sign-in. A lookup by identity first; then an account
 * row without identities that names it, which only a Worker from before identities writes during a
 * deploy; then a new account with the identity in one batch. A second sign-in racing the first for a new
 * identity fails the batch on the primary key and reads what the first one made. A known identity takes
 * the login and any name the provider sent this time.
 */
export const resolveAccount = async (db: D1Database, provider: ProviderId, identity: ProviderIdentity, now = Date.now()): Promise<string | null> => {
    const known = await db
        .prepare('UPDATE identity SET login = ?3, display_name = COALESCE(?4, display_name) WHERE provider = ?1 AND subject = ?2 RETURNING account_id')
        .bind(provider, identity.subject, identity.login, identity.displayName)
        .first<{ account_id: string }>();
    if (known) {
        return known.account_id;
    }
    const legacy = await db
        .prepare(
            `SELECT id FROM account WHERE provider = ?1 AND subject = ?2
             AND NOT EXISTS (SELECT 1 FROM identity WHERE identity.account_id = account.id AND identity.provider = ?1)`
        )
        .bind(provider, identity.subject)
        .first<{ id: string }>();
    if (legacy) {
        await db
            .prepare(
                'INSERT INTO identity (provider, subject, account_id, login, display_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING'
            )
            .bind(provider, identity.subject, legacy.id, identity.login, identity.displayName, now)
            .run();
    } else {
        const accountId = crypto.randomUUID();
        try {
            await db.batch([
                db
                    .prepare('INSERT INTO account (id, provider, subject, login, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
                    .bind(accountId, provider, identity.subject, identity.login, now),
                db
                    .prepare('INSERT INTO identity (provider, subject, account_id, login, display_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
                    .bind(provider, identity.subject, accountId, identity.login, identity.displayName, now)
            ]);
            return accountId;
        } catch (error) {
            console.warn('a new account lost a race, reading the one that won', error);
        }
    }
    const row = await db
        .prepare('SELECT account_id FROM identity WHERE provider = ?1 AND subject = ?2')
        .bind(provider, identity.subject)
        .first<{ account_id: string }>();
    return row?.account_id ?? null;
};

export const accountResult = async (db: D1Database, accountId: string): Promise<AccountResult | null> => {
    const [accountRows, identityRows] = await db.batch([
        db
            .prepare(
                `SELECT account.id, ${accountProviderSql('account.id')} AS provider, ${accountLoginSql('account.id')} AS login,
                     ${accountDisplayNameSql('account.id')} AS display_name
                 FROM account WHERE account.id = ?1`
            )
            .bind(accountId),
        db.prepare('SELECT provider, login, display_name, created_at FROM identity WHERE account_id = ?1 ORDER BY created_at, provider').bind(accountId)
    ]);
    const account = (accountRows?.results ?? [])[0] as (Omit<AccountRow, 'displayName'> & { display_name: string | null }) | undefined;
    if (!account) {
        return null;
    }
    const identities: Identity[] = (
        (identityRows?.results ?? []) as { provider: ProviderId; login: string | null; display_name: string | null; created_at: number }[]
    ).map((row) => ({
        provider: row.provider,
        login: row.login,
        displayName: row.display_name,
        createdAt: row.created_at
    }));
    return { account: { id: account.id, provider: account.provider, login: account.login, displayName: account.display_name }, identities };
};

const answerAccount = async (db: D1Database, session: SessionContext): Promise<Response> => {
    const result = await accountResult(db, session.account.id);
    return result ? json(result) : signInAgain();
};

// `GET /v1/account`
export const getAccount = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    return session ? answerAccount(env.DB, session) : signInAgain();
};

// `POST /v1/account/link`: a token for the start URL of the provider to add, bound to this session.
export const startIdentityLink = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const limited = await overAnyLimit(env.DB, [
        [`account:${session.account.id}:link`, LIMITS.linkAccount],
        [`ip:${clientIp(request)}:login`, LIMITS.loginIp]
    ]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, IdentityLinkStartPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const { provider } = body.value;
    if (!PROVIDERS[provider].configured(env)) {
        return failure('not-configured', `Signing in with ${PROVIDER_NAMES[provider]} is not available on this address book yet`);
    }
    const linked = await env.DB.prepare('SELECT 1 AS linked FROM identity WHERE account_id = ?1 AND provider = ?2')
        .bind(session.account.id, provider)
        .first<{ linked: number }>();
    if (linked) {
        return providerLinked(provider);
    }
    const linkToken = randomToken();
    const expiresAt = Date.now() + LINK_REQUEST_LIFETIME_MS;
    await env.DB.prepare('INSERT INTO identity_link_request (token_hash, account_id, session_id, provider, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(await sha256(linkToken), session.account.id, session.id, provider, expiresAt)
        .run();
    return json({ linkToken, expiresAt });
};

export interface LinkStart {
    accountId: string;
    sessionId: string;
}

/*
 * Spends a link token at the start of a login. Refused unless it is fresh, for this provider, and the
 * session that asked for it is still signed in: a person who signed out in between adds nothing.
 */
export const spendLinkToken = async (db: D1Database, linkToken: string, provider: ProviderId): Promise<LinkStart | null> => {
    const now = Date.now();
    const row = await db
        .prepare(
            `DELETE FROM identity_link_request WHERE token_hash = ?1 RETURNING account_id, session_id, provider, expires_at,
                 (SELECT COUNT(*) FROM session WHERE session.id = identity_link_request.session_id AND session.revoked_at IS NULL AND session.expires_at > ?2) AS live`
        )
        .bind(await sha256(linkToken), now)
        .first<{ account_id: string; session_id: string; provider: string; expires_at: number; live: number }>();
    if (!row || row.expires_at <= now || row.provider !== provider || row.live !== 1) {
        return null;
    }
    return { accountId: row.account_id, sessionId: row.session_id };
};

// The callback of a link login: the identity waits under a code for the session that started it.
export const storeLinkCode = async (
    db: D1Database,
    input: { link: LinkStart; provider: ProviderId; identity: ProviderIdentity; appRedirectUri: string; appCodeChallenge: string }
): Promise<string> => {
    const code = randomToken();
    await db
        .prepare(
            `INSERT INTO identity_link_code (code_hash, account_id, session_id, provider, subject, login, display_name, app_redirect_uri, app_code_challenge, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
        )
        .bind(
            await sha256(code),
            input.link.accountId,
            input.link.sessionId,
            input.provider,
            input.identity.subject,
            input.identity.login,
            input.identity.displayName,
            input.appRedirectUri,
            input.appCodeChallenge,
            Date.now() + LINK_CODE_LIFETIME_MS
        )
        .run();
    return code;
};

interface LinkCodeRow {
    account_id: string;
    session_id: string;
    provider: ProviderId;
    subject: string;
    login: string | null;
    display_name: string | null;
    app_redirect_uri: string;
    app_code_challenge: string;
    expires_at: number;
}

/*
 * `POST /v1/account/identities`: the identity lands on the account only when the session that asked for
 * the link presents the code with the PKCE verifier of that login. The access token proves the session,
 * the verifier proves the login came back to the app that started it.
 */
export const completeIdentityLink = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:session`, LIMITS.sessionIp]]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, IdentityLinkCompletePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const { code, codeVerifier, redirectUri } = body.value;
    // Spent on the first try, like a login code.
    const row = await env.DB.prepare('DELETE FROM identity_link_code WHERE code_hash = ?1 RETURNING *')
        .bind(await sha256(code))
        .first<LinkCodeRow>();
    if (!row || row.expires_at <= Date.now()) {
        return failure('unauthorized', 'The sign-in to add expired or was already used. Start again.');
    }
    if (row.session_id !== session.id || row.app_redirect_uri !== redirectUri || (await sha256(codeVerifier)) !== row.app_code_challenge) {
        return failure('unauthorized', 'This sign-in was started from another session. Start again.');
    }
    const owner = await env.DB.prepare('SELECT account_id FROM identity WHERE provider = ?1 AND subject = ?2')
        .bind(row.provider, row.subject)
        .first<{ account_id: string }>();
    if (owner && owner.account_id !== session.account.id) {
        return identityTaken(row.provider);
    }
    if (owner) {
        await env.DB.prepare('UPDATE identity SET login = ?3, display_name = COALESCE(?4, display_name) WHERE provider = ?1 AND subject = ?2')
            .bind(row.provider, row.subject, row.login, row.display_name)
            .run();
    } else {
        const inserted = await env.DB.prepare(
            `INSERT INTO identity (provider, subject, account_id, login, display_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT DO NOTHING RETURNING account_id`
        )
            .bind(row.provider, row.subject, session.account.id, row.login, row.display_name, Date.now())
            .first<{ account_id: string }>();
        if (!inserted) {
            // Either unique pair held: the identity went to another account in the meantime, or this account got one of the provider.
            const current = await env.DB.prepare('SELECT account_id FROM identity WHERE provider = ?1 AND subject = ?2')
                .bind(row.provider, row.subject)
                .first<{ account_id: string }>();
            if (current?.account_id !== session.account.id) {
                return current ? identityTaken(row.provider) : providerLinked(row.provider);
            }
        }
    }
    return answerAccount(env.DB, session);
};

/*
 * `DELETE /v1/account/identities/<provider>`. Refused for the last identity, in the statement itself, so
 * two removals at once cannot both pass a count read before either wrote. The account's own provider and
 * subject are rewritten when they name the identity, so signing in with it later makes a new account.
 */
export const unlinkIdentity = async (request: Request, env: Env, rawProvider: string): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const parsed = ProviderIdSchema.safeParse(rawProvider);
    if (!parsed.success) {
        return failure('not-found', 'No such sign-in provider');
    }
    const provider = parsed.data;
    const accountId = session.account.id;
    const removed = await env.DB.prepare(
        `DELETE FROM identity WHERE account_id = ?1 AND provider = ?2 AND (SELECT COUNT(*) FROM identity WHERE account_id = ?1) > 1
         RETURNING subject`
    )
        .bind(accountId, provider)
        .first<{ subject: string }>();
    if (!removed) {
        const exists = await env.DB.prepare('SELECT 1 AS present FROM identity WHERE account_id = ?1 AND provider = ?2')
            .bind(accountId, provider)
            .first<{ present: number }>();
        return exists
            ? failure('last-identity', 'This is the only way to sign in to this account, so it stays. Add another one first.')
            : failure('not-found', `This account does not sign in with ${PROVIDER_NAMES[provider]}`);
    }
    await env.DB.prepare(`UPDATE account SET subject = 'unlinked:' || id WHERE id = ?1 AND provider = ?2 AND subject = ?3`)
        .bind(accountId, provider, removed.subject)
        .run();
    return answerAccount(env.DB, session);
};

// `GET /v1/providers`: what a client may offer, so a provider without its secrets is never a button.
export const listProviders = (env: Env): Response =>
    json({
        providers: Object.values(PROVIDERS)
            .filter((provider) => provider.configured(env))
            .map((provider) => provider.id)
    });
