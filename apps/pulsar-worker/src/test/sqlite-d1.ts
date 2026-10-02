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

interface ShimStatement {
    batched(): { results: unknown[]; meta: { changes: number }; success: true };
}

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
                },
                batched() {
                    const results = database.query(sql).all(...(values as never[]));
                    const { changes } = database.query('SELECT changes() AS changes').get() as { changes: number };
                    return { results, meta: { changes }, success: true as const };
                }
            });
            return query();
        },
        // One transaction, as D1 runs a batch.
        async batch(statements: ShimStatement[]) {
            return database.transaction(() => statements.map((statement) => statement.batched()))();
        }
    }) as unknown as D1Database;
