-- When the refresh token last rotated and the salt its pair was derived with, so a retry of a rotation whose answer
-- got lost gets the same pair back. Nullable, so the Worker that is still running while this applies keeps rotating;
-- a rotation it makes leaves a salt that derives another pair, and a retry of that one is reuse as before.
ALTER TABLE session ADD COLUMN rotated_at INTEGER;
ALTER TABLE session ADD COLUMN rotation_salt TEXT;
