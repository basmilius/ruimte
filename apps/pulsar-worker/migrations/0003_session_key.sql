-- The key a session is bound to: every refresh has to be signed with it. Nullable, so the Worker that is still
-- running while this applies keeps working; the new Worker refuses to refresh a session without one, which
-- signs out every session from before, rather than leaving them unbound.
ALTER TABLE session ADD COLUMN session_key TEXT;

-- A machine a person took off an account. A client that reaches it does not put it back on its own; a person
-- adding it again does, and clears the row.
CREATE TABLE removed_machine (
    account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    removed_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, machine_id)
);
