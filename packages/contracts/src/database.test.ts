import { describe, expect, test } from 'bun:test';
import { DatabaseConnectionsSavePayloadSchema, readDatabaseEntries } from './database.ts';

describe('database connections on the wire', () => {
    test('a config keeps every field the host checks on open', () => {
        const connection = {
            id: 'shop',
            name: 'Shop',
            config: { engine: 'mysql', host: '', user: 'root', tls: 'require', tunnel: { kind: 'docker', container: 'shop-db-1', port: 3306 } },
            shared: false
        } as const;
        const parsed = DatabaseConnectionsSavePayloadSchema.parse({ projectId: 'p1', baseRev: 0, connections: [connection] });
        expect(parsed.connections[0]).toEqual(connection);
    });

    test('a SQLite config names its file', () => {
        const payload = { projectId: 'p1', baseRev: 0, connections: [{ id: 'a', name: 'A', config: { engine: 'sqlite' }, shared: false }] };
        expect(DatabaseConnectionsSavePayloadSchema.safeParse(payload).success).toBe(false);
    });

    test('an entry this release cannot read is kept as it stands', () => {
        const postgres = { id: 'pg', name: 'Analytics', config: { engine: 'postgres', host: 'db' } };
        const sqlite = { id: 'local', name: 'Local', config: { engine: 'sqlite', path: 'data/app.sqlite' } } as const;
        expect(readDatabaseEntries([sqlite, postgres, 'nonsense'])).toEqual([{ connection: sqlite }, { raw: postgres }, { raw: 'nonsense' }]);
    });
});
