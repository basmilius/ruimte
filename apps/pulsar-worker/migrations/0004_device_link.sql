-- A machine waiting to be linked with a code (`ruimte login`). The device code only the terminal holds is kept
-- as a hash; the short user code is only worth something with a signed-in session and a rate limit in front.
-- A new table, so the Worker that is still running while this applies never sees it.
CREATE TABLE device_link (
    device_code_hash TEXT PRIMARY KEY,
    user_code TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    broker_url TEXT,
    public_key TEXT NOT NULL,
    -- pending, approved, denied, cancelled or done
    status TEXT NOT NULL,
    account_id TEXT REFERENCES account (id) ON DELETE CASCADE,
    ip TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    expires_at INTEGER NOT NULL
);
CREATE INDEX device_link_user_code ON device_link (user_code, status);
CREATE INDEX device_link_expires ON device_link (expires_at);
