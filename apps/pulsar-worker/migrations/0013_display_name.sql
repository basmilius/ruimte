-- The person's name at the provider. Nullable, so the Worker that is still running while this applies keeps inserting.
-- Apple sends it only on the first authorization, so a missing name never clears a stored one.
ALTER TABLE identity ADD COLUMN display_name TEXT;
-- A link login carries the name to the identity it adds.
ALTER TABLE identity_link_code ADD COLUMN display_name TEXT;
