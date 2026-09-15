CREATE TABLE push_device (
    handle TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    environment TEXT NOT NULL CHECK(environment IN ('sandbox', 'production')),
    start_token TEXT,
    updated_at INTEGER NOT NULL,
    UNIQUE(session_id, environment)
);
CREATE TABLE push_activity (
    handle TEXT NOT NULL REFERENCES push_device(handle) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    collapse_id TEXT NOT NULL,
    token TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(handle, machine_id, collapse_id)
);
CREATE TABLE push_receipt (
    handle TEXT NOT NULL REFERENCES push_device(handle) ON DELETE CASCADE,
    id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(handle, id)
);
CREATE TABLE push_activity_start (
    handle TEXT NOT NULL REFERENCES push_device(handle) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    collapse_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(handle, machine_id, collapse_id)
);
