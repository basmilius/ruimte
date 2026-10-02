import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* An in-memory database with every migration applied, the schema the Worker's D1 has. */
export const migratedDatabase = (): Database => {
    const database = new Database(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    const migrations = join(import.meta.dir, '../../migrations');
    for (const file of readdirSync(migrations).sort()) {
        database.exec(readFileSync(join(migrations, file), 'utf8'));
    }
    return database;
};

// The Worker's real SQL runs on SQLite; only the D1 transport is adapted.
export const d1 = (database: Database): D1Database =>
    ({
        prepare(sql: string) {
            const query = (values: unknown[] = []) => ({
                bind(...bound: unknown[]) {
                    return query(bound);
                },
                async first() {
                    return database.query(sql).get(...(values as never[])) ?? null;
                },
                async run() {
                    const result = database.query(sql).run(...(values as never[]));
                    return { meta: { changes: result.changes }, success: true };
                },
                async all() {
                    return { results: database.query(sql).all(...(values as never[])), success: true };
                }
            });
            return query();
        }
    }) as unknown as D1Database;
