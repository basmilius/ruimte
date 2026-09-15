import type { D1Database as WorkerDatabase, JsonWebKey as WorkerJsonWebKey } from '@cloudflare/workers-types';

// Tests execute imported Worker handlers in Bun without replacing Bun's Buffer and fetch globals.
declare global {
    type D1Database = WorkerDatabase;
    type JsonWebKey = WorkerJsonWebKey;
    type HeadersInit = Bun.HeadersInit;
}
