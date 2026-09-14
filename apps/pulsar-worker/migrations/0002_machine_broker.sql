-- The broker a machine announces itself to, so a client that has never reached it knows where to signal.
-- A nullable column, so the Worker that is still running while this applies keeps reading and writing machines.
ALTER TABLE machine ADD COLUMN broker_url TEXT;
