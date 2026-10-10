import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection } from '@ruimte/contracts';
import type { DatabaseResponse, TableStructure } from '@adecore/database/protocol';
import { startDatabaseOf } from './agent-databases.ts';
import { generationOf, SchemaSnapshots, viewQueryOf } from './schema-snapshots.ts';

let root = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-snapshots-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const USERS: TableStructure = {
    schema: 'shop',
    name: 'users',
    kind: 'table',
    columns: [
        { name: 'id', type: 'bigint(20) unsigned', kind: 'integer', nullable: false, defaultValue: null, autoIncrement: true, generated: false, comment: null },
        {
            name: 'email',
            type: 'varchar(255)',
            kind: 'text',
            nullable: false,
            defaultValue: "''",
            autoIncrement: false,
            generated: false,
            comment: 'Where mail goes'
        },
        { name: 'domain', type: 'varchar(255)', kind: 'text', nullable: true, defaultValue: null, autoIncrement: false, generated: true, comment: '' },
        { name: 'org_id', type: 'int(11)', kind: 'integer', nullable: true, defaultValue: null, autoIncrement: false, generated: false, comment: null }
    ],
    primaryKey: ['id'],
    rowKey: ['id'],
    indexes: [
        { name: 'PRIMARY', columns: ['id'], unique: true, primary: true },
        { name: 'users_email', columns: ['email'], unique: true, primary: false },
        { name: 'users_org', columns: ['org_id'], unique: false, primary: false }
    ],
    foreignKeys: [
        {
            name: 'users_org_fk',
            columns: ['org_id'],
            referencedSchema: 'shop',
            referencedTable: 'orgs',
            referencedColumns: ['id'],
            onUpdate: null,
            onDelete: 'SET NULL'
        }
    ],
    checks: [{ name: 'email_check', expression: "email <> ''" }],
    triggers: [{ name: 'users_touch', timing: 'BEFORE', event: 'UPDATE' }],
    ddl: 'CREATE TABLE `users` (...)'
};

const ACTIVE: TableStructure = {
    schema: 'shop',
    name: 'active_users',
    kind: 'view',
    columns: [
        { name: 'id', type: 'bigint(20) unsigned', kind: 'integer', nullable: false, defaultValue: null, autoIncrement: false, generated: false, comment: null }
    ],
    primaryKey: [],
    rowKey: null,
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `active_users` AS select `users`.`id` AS `id` from `users`'
};

interface Fake {
    service: { handle(request: unknown, owner: string): Promise<DatabaseResponse>; release(owner: string): Promise<void> };
    calls: { method: string; params: Record<string, unknown>; owner: string }[];
    released: string[];
    columns: { comment: string };
}

/* A helper that answers like MariaDB with one database of a table and a view. */
function fakeService(answer: (method: string, params: Record<string, unknown>) => unknown = () => undefined): Fake {
    const calls: Fake['calls'] = [];
    const released: string[] = [];
    const columns = { comment: 'Where mail goes' };
    const results = (method: string, params: Record<string, unknown>): unknown => {
        const own = answer(method, params);
        if (own !== undefined) {
            return own;
        }
        switch (method) {
            case 'open':
                return { session: 's1', server: { flavor: 'mariadb', version: '11.4.2-MariaDB' } };
            case 'schemas':
                return {
                    schemas: [
                        { name: 'information_schema', system: true },
                        { name: 'shop', system: false },
                        { name: 'stats', system: false }
                    ]
                };
            case 'tables':
                return params.schema === 'shop'
                    ? {
                          tables: [
                              { name: 'users', kind: 'table', rowEstimate: 12, comment: 'People who log in' },
                              { name: 'active_users', kind: 'view', rowEstimate: null, comment: null }
                          ]
                      }
                    : { tables: [] };
            case 'structure': {
                const structure = params.table === 'users' ? USERS : ACTIVE;
                return {
                    ...structure,
                    columns: structure.columns.map((column) => (column.name === 'email' ? { ...column, comment: columns.comment } : column))
                };
            }
            case 'execute':
                return {
                    results: [
                        {
                            kind: 'rows',
                            sql: '',
                            columns: [],
                            rows: [['STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO', 0]],
                            hasMore: false,
                            elapsedMs: 1
                        }
                    ],
                    inTransaction: false
                };
            default:
                return null;
        }
    };
    return {
        calls,
        released,
        columns,
        service: {
            handle: async (request, owner) => {
                const { id, method, params } = request as { id: string; method: string; params: Record<string, unknown> };
                calls.push({ method, params, owner });
                const result = results(method, params);
                if (result instanceof Error) {
                    return { id, ok: false, error: { code: 'auth-failed', message: result.message } } as DatabaseResponse;
                }
                return { id, ok: true, result } as DatabaseResponse;
            },
            release: async (owner) => {
                released.push(owner);
            }
        }
    };
}

const SHOP: DatabaseConnection = {
    id: 'shop',
    name: 'Shop',
    shared: false,
    config: { engine: 'mysql', host: '127.0.0.1', user: 'root', database: 'shop' }
};

function snapshots(fake: Fake, passwords: Record<string, string> = {}): SchemaSnapshots {
    return new SchemaSnapshots({
        root,
        service: fake.service,
        passwordOf: (_projectId, connectionId) => passwords[connectionId] ?? null,
        now: () => new Date('2026-10-07T09:00:00.000Z')
    });
}

describe('schema snapshots', () => {
    test('a snapshot holds names, types, keys and comments in the format of the SQL server, never a credential or a row', async () => {
        const fake = fakeService();
        const facts = await snapshots(fake, { shop: 'hunter2' }).take('p1', SHOP, 'shop');
        expect(facts).toMatchObject({ connectionId: 'shop', database: 'shop', dialect: 'mariadb', version: '11.4.2-MariaDB', tables: 2 });
        const text = await readFile(facts.path, 'utf8');
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('root@');
        const snapshot = JSON.parse(text);
        expect(snapshot.source).toEqual({
            dialect: 'mariadb',
            product: 'MariaDB',
            version: '11.4.2-MariaDB',
            sqlMode: 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO',
            lowerCaseTableNames: 0,
            takenAt: '2026-10-07T09:00:00.000Z'
        });
        expect(snapshot.formatVersion).toBe(1);
        expect(snapshot.defaultSchema).toBe('shop');
        const [schema] = snapshot.schemas;
        expect(schema.name).toBe('shop');
        const [users, active] = schema.tables;
        expect(users).toEqual({
            name: 'users',
            kind: 'table',
            comment: 'People who log in',
            columns: [
                { name: 'id', type: 'bigint(20) unsigned', nullable: false, autoIncrement: true, ordinal: 1 },
                { name: 'email', type: 'varchar(255)', nullable: false, default: "''", comment: 'Where mail goes', ordinal: 2 },
                { name: 'domain', type: 'varchar(255)', nullable: true, generated: 'stored', ordinal: 3 },
                { name: 'org_id', type: 'int(11)', nullable: true, ordinal: 4 }
            ],
            primaryKey: { name: 'PRIMARY', columns: ['id'] },
            uniqueKeys: [{ name: 'users_email', columns: ['email'] }],
            indexes: [
                { name: 'users_email', columns: ['email'], unique: true },
                { name: 'users_org', columns: ['org_id'], unique: false }
            ],
            foreignKeys: [
                {
                    name: 'users_org_fk',
                    columns: ['org_id'],
                    referencedSchema: 'shop',
                    referencedTable: 'orgs',
                    referencedColumns: ['id'],
                    onDelete: 'set null'
                }
            ],
            checks: [{ name: 'email_check', expression: "email <> ''" }]
        });
        expect(active).toMatchObject({ name: 'active_users', kind: 'view', definition: 'select `users`.`id` AS `id` from `users`' });
        expect(schema.triggers).toEqual([{ name: 'users_touch', table: 'users', timing: 'before', events: ['update'] }]);
    });

    test('opens a read-only session with the password handed over for where the connection points, and closes it', async () => {
        const fake = fakeService();
        await snapshots(fake, { shop: 'hunter2' }).take('p1', SHOP, 'shop');
        const open = fake.calls.find((call) => call.method === 'open')!;
        expect(open.params.connection).toEqual({ engine: 'mysql', host: '127.0.0.1', user: 'root', database: 'shop', password: 'hunter2', readOnly: true });
        expect(fake.released).toEqual([open.owner]);
        expect(fake.calls.every((call) => call.method !== 'rows' && call.method !== 'page')).toBe(true);
    });

    test('rewrites the file only when what it says changed', async () => {
        const fake = fakeService();
        const taker = new SchemaSnapshots({ root, service: fake.service, passwordOf: () => null, now: () => new Date('2026-10-07T09:00:00.000Z') });
        const first = await taker.take('p1', SHOP, 'shop');
        const before = await stat(first.path);
        const later = new SchemaSnapshots({ root, service: fake.service, passwordOf: () => null, now: () => new Date('2026-10-08T09:00:00.000Z') });
        const same = await later.take('p1', SHOP, 'shop');
        expect(same.takenAt).toBe('2026-10-07T09:00:00.000Z');
        expect((await stat(first.path)).mtimeMs).toBe(before.mtimeMs);
        fake.columns.comment = 'Where the mail goes';
        const changed = await later.take('p1', SHOP, 'shop');
        expect(changed.takenAt).toBe('2026-10-08T09:00:00.000Z');
        expect(await readFile(changed.path, 'utf8')).toContain('Where the mail goes');
        expect((await readdir(join(first.path, '..'))).filter((name) => name.endsWith('.partial'))).toEqual([]);
    });

    test('a connection that starts in no database is read whole, without a default', async () => {
        const fake = fakeService();
        const { database: _database, ...config } = SHOP.config as Record<string, unknown>;
        const server = { ...SHOP, config: config as DatabaseConnection['config'] };
        expect(startDatabaseOf(server)).toBeNull();
        const facts = await snapshots(fake).take('p1', server, null);
        const snapshot = JSON.parse(await readFile(facts.path, 'utf8'));
        expect(snapshot.defaultSchema).toBeUndefined();
        expect(snapshot.schemas.map((schema: { name: string }) => schema.name)).toEqual(['shop', 'stats']);
        expect(facts.path.endsWith('%40all.json')).toBe(true);
    });

    test('says why when the machine has no password, and when the database is not there', async () => {
        const locked = fakeService((method) => (method === 'open' ? new Error('Access denied') : undefined));
        await expect(snapshots(locked).take('p1', SHOP, 'shop')).rejects.toThrow('Shop needs a password this machine does not have');
        await expect(snapshots(fakeService()).take('p1', SHOP, 'gone')).rejects.toThrow('Shop has no database gone');
    });

    test('keeps a name a glob would read as more than itself out of the path, and lists what it took', async () => {
        const taker = snapshots(fakeService());
        expect(taker.pathOf('p1', { connectionId: 'a*b', database: 'it(s)' })).toBe(join(root, 'p1', 'a%2Ab', 'it%28s%29.json'));
        await taker.take('p1', SHOP, 'shop');
        expect((await taker.list('p1')).map((facts) => [facts.connectionId, facts.database])).toEqual([['shop', 'shop']]);
        await taker.forget('p1', 'shop');
        expect(await taker.list('p1')).toEqual([]);
    });

    test('a take asked for while one runs follows it once, however many ask', async () => {
        let opened = 0;
        const fake = fakeService((method) => {
            if (method === 'open') {
                opened += 1;
            }
            return undefined;
        });
        const taker = snapshots(fake);
        await Promise.all([taker.take('p1', SHOP, 'shop'), taker.take('p1', SHOP, 'shop'), taker.take('p1', SHOP, 'shop')]);
        expect(opened).toBe(2);
    });

    test('reads how a column is generated off its line of the table the server writes', () => {
        const ddl = [
            'CREATE TABLE `users` (',
            '  `email` varchar(255) NOT NULL,',
            "  `domain` varchar(255) GENERATED ALWAYS AS (substring_index(`email`,'@',-1)) VIRTUAL,",
            '  `lower` varchar(255) AS (lower(`email`)) PERSISTENT',
            ')'
        ].join('\n');
        expect(generationOf(ddl, 'domain')).toEqual({ generated: 'virtual', generationExpression: "substring_index(`email`,'@',-1)" });
        expect(generationOf(ddl, 'lower')).toEqual({ generated: 'stored', generationExpression: 'lower(`email`)' });
        expect(generationOf(null, 'domain')).toEqual({ generated: 'stored' });
    });

    test('reads the query of a view out of what the server writes', () => {
        expect(viewQueryOf('CREATE VIEW "active" AS SELECT id FROM users;')).toBe('SELECT id FROM users');
        expect(viewQueryOf('CREATE VIEW v (a, b) AS SELECT 1, 2')).toBe('SELECT 1, 2');
        expect(viewQueryOf(null)).toBeUndefined();
    });
});
