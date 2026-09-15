-- An account holds one or more identities, one per provider, so GitHub and Apple can open the same account.
-- The provider, subject and login on `account` stay: the Worker that is still running while this applies
-- keeps writing them, and dropping columns of a table other tables reference would mean rebuilding it.
-- The identities are the truth from here on; `account.subject` of an identity that was removed is rewritten
-- so a later sign-in with it can make a new account without meeting the old unique pair.
CREATE TABLE identity (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    login TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX identity_account_provider ON identity (account_id, provider);

INSERT INTO identity (provider, subject, account_id, login, created_at)
SELECT provider, subject, id, login, created_at FROM account;

-- A signed-in session asking to add a provider: the token rides in the start URL and is spent there.
CREATE TABLE identity_link_request (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- A link login between the start and the callback carries the session it was started from.
-- Nullable, so the Worker that is still running while this applies keeps inserting attempts.
ALTER TABLE login_attempt ADD COLUMN link_account_id TEXT;
ALTER TABLE login_attempt ADD COLUMN link_session_id TEXT;

-- The identity a link login proved, waiting for the same session to trade the code with its PKCE verifier.
-- A table of its own rather than `login_code`, so `/v1/session` can never turn it into a session.
CREATE TABLE identity_link_code (
    code_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    login TEXT,
    app_redirect_uri TEXT NOT NULL,
    app_code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
