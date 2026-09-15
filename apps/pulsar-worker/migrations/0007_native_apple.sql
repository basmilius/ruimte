CREATE TABLE native_apple_login (
    attempt_hash TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX native_apple_login_expiry ON native_apple_login (expires_at);
