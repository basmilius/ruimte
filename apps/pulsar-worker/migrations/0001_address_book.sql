-- The address book. Times are milliseconds since the epoch, keys and signatures base64url.

-- An account is who a provider says someone is, never an email: an address changes hands, a user id does not.
CREATE TABLE account (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    login TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (provider, subject)
);

-- A machine is keyed on the account as well: a daemon shared by two people can sit in both their lists.
CREATE TABLE machine (
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    public_key TEXT NOT NULL,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, id)
);

-- A device is a client key that asked for a statement while signed in to this account.
CREATE TABLE device (
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    label TEXT,
    last_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, public_key)
);

-- Every statement handed out, so a client can show who got access to which machine and when.
CREATE TABLE statement_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    ip TEXT,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX statement_log_account ON statement_log (account_id, issued_at);

-- A login between the start and the callback: the provider state, both PKCE challenges and where the app wants the answer.
CREATE TABLE login_attempt (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    browser_hash TEXT NOT NULL,
    provider_verifier TEXT NOT NULL,
    app_redirect_uri TEXT NOT NULL,
    app_state TEXT NOT NULL,
    app_code_challenge TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- The one-time code the callback hands the app, only worth a session together with the app's PKCE verifier.
CREATE TABLE login_code (
    code_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    app_redirect_uri TEXT NOT NULL,
    app_code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Tokens are stored as hashes, so a leaked database row cannot be replayed as a bearer.
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    label TEXT,
    access_hash TEXT NOT NULL UNIQUE,
    access_expires_at INTEGER NOT NULL,
    refresh_hash TEXT NOT NULL UNIQUE,
    previous_refresh_hash TEXT,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX session_account ON session (account_id);
CREATE INDEX session_previous_refresh ON session (previous_refresh_hash);

-- Fixed windows per key (`ip:...` or `account:...` plus the route), exact where the platform limiter is per location.
CREATE TABLE rate_limit (
    bucket TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (bucket, window_start)
);
