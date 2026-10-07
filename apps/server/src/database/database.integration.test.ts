import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection } from '@ruimte/contracts';
import type { Cell, DatabaseResponse } from '@adecore/database/protocol';
import { CodedError } from '@adecore/agents/coded-error';
import { MachineHome } from '../fs/machine-home.ts';
import { DatabaseAccessStore } from './agent-access.ts';
import { AgentDatabases, type DatabasePlace } from './agent-databases.ts';
import { DatabasePasswords } from './agent-passwords.ts';
import { DatabaseService, databaseHelperPath } from './database-service.ts';

/*
 * The real helper. SQLite always; MySQL or MariaDB only against the server `RUIMTE_TEST_MYSQL_URL`
 * names (`mysql://user:password@host:port/database`), in a container that publishes that port, since
 * the Docker tunnel and discovery are tested on it too. Only tables of this test's own are written.
 */
const MYSQL_URL = process.env.RUIMTE_TEST_MYSQL_URL;

let nextId = 1;

function call(service: DatabaseService, owner: string, method: string, params: Record<string, unknown>, local = false): Promise<DatabaseResponse> {
    return service.handle({ id: `r${nextId++}`, method, params }, owner, local);
}

/* The result of a request that has to succeed, or the error it answered in the failure. */
async function ok<T>(response: Promise<DatabaseResponse>): Promise<T> {
    const answered = await response;
    if (!answered.ok) {
        throw new Error(`${answered.error.code}: ${answered.error.message}`);
    }
    return answered.result as T;
}

/* The agents' door over the real helper, for one project whose connections are these. */
async function agentDatabases(service: DatabaseService, home: string, connections: DatabaseConnection[]) {
    const access = new DatabaseAccessStore(home);
    await access.load();
    const passwords = new DatabasePasswords();
    const agents = new AgentDatabases({
        service,
        connections: { connectionsOf: async () => connections },
        projects: { holdersOf: () => ['client-1'] },
        access,
        passwords,
        scratchFolder: join(home, 'scratch')
    });
    return { agents, access };
}

/* The code an agent's call is refused with, or null when it went through. */
async function refusedWith(work: Promise<unknown>): Promise<string | null> {
    try {
        await work;
        return null;
    } catch (e) {
        if (e instanceof CodedError) {
            return e.code;
        }
        throw e;
    }
}

describe.skipIf(databaseHelperPath() === null)('the database helper on SQLite', () => {
    let root: string;
    let home: string;
    let service: DatabaseService;
    let path: string;

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'database-')));
        home = join(root, 'home');
        await mkdir(home, { recursive: true });
        path = join(root, 'shop.sqlite');
        service = new DatabaseService({ machineHome: new MachineHome(home) });
    });

    afterAll(async () => {
        await service.dispose();
        await rm(root, { recursive: true, force: true });
    });

    test('opens a new file, reads its tables and rows and applies a change', async () => {
        const { session, server } = await ok<{ session: string; server: { flavor: string } }>(
            call(service, 'client-1', 'open', { connection: { engine: 'sqlite', path, create: true } }, true)
        );
        expect(server.flavor).toBe('sqlite');

        await ok(
            call(service, 'client-1', 'execute', {
                session,
                sql: "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO customers (name) VALUES ('Amara'), ('Bram');"
            })
        );
        const { tables } = await ok<{ tables: { name: string }[] }>(call(service, 'client-1', 'tables', { session, schema: 'main' }));
        expect(tables.map((table) => table.name)).toEqual(['customers']);

        const applied = await ok<{ affected: number }>(
            call(service, 'client-1', 'apply', {
                session,
                schema: 'main',
                table: 'customers',
                changes: [
                    { kind: 'update', key: { id: 1 }, values: { name: 'Amara Okafor' } },
                    { kind: 'insert', values: { name: 'Chen' } }
                ]
            })
        );
        expect(applied.affected).toBe(2);

        const { rows } = await ok<{ rows: unknown[][] }>(
            call(service, 'client-1', 'rows', { session, schema: 'main', table: 'customers', offset: 0, limit: 10 })
        );
        expect(rows).toEqual([
            [1, 'Amara Okafor'],
            [2, 'Bram'],
            [3, 'Chen']
        ]);
    });

    test('exports only for a client that presented the local secret', async () => {
        const target = join(root, 'customers.csv');
        const source = { kind: 'table', schema: 'main', table: 'customers' };

        const remote = await ok<{ session: string }>(call(service, 'client-2', 'open', { connection: { engine: 'sqlite', path } }));
        expect(await call(service, 'client-2', 'export', { session: remote.session, source, format: 'csv', path: target })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });

        const local = await ok<{ session: string }>(call(service, 'client-1', 'open', { connection: { engine: 'sqlite', path } }, true));
        const exported = await ok<{ rows: number }>(call(service, 'client-1', 'export', { session: local.session, source, format: 'csv', path: target }, true));
        expect(exported.rows).toBe(3);
        expect(await readFile(target, 'utf8')).toBe('id,name\r\n1,Amara Okafor\r\n2,Bram\r\n3,Chen\r\n');
    });

    test('never opens a file in the machine state', async () => {
        const response = await call(service, 'client-1', 'open', { connection: { engine: 'sqlite', path: join(home, 'state.sqlite'), create: true } }, true);
        expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    test('an agent reads through a read-only session and writes only where a person allowed it', async () => {
        const project = join(root, 'project');
        await mkdir(project, { recursive: true });
        const file = join(project, 'agent.sqlite');
        const { session } = await ok<{ session: string }>(
            call(service, 'client-9', 'open', { connection: { engine: 'sqlite', path: file, create: true } }, true)
        );
        await ok(
            call(service, 'client-9', 'execute', {
                session,
                sql: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL NOT NULL); INSERT INTO orders (total) VALUES (500), (1500), (2500), (750);'
            })
        );
        await service.release('client-9');
        const place: DatabasePlace = { projectId: 'p1', folder: project };
        const { agents, access } = await agentDatabases(service, home, [{ id: 'shop', name: 'Shop', shared: false, config: { engine: 'sqlite', path: file } }]);

        const query = await agents.query(place, 'chat-1', 'shop', 'SELECT id, total FROM orders WHERE total > 1000 ORDER BY id DESC', {
            schema: null,
            limit: 10
        });
        expect(query.result.rows).toEqual([
            [3, 2500],
            [2, 1500]
        ]);
        expect(await refusedWith(agents.query(place, 'chat-1', 'shop', 'DELETE FROM orders', { schema: null, limit: 10 }))).toBe('unsupported');
        expect(
            await refusedWith(agents.query(place, 'chat-1', 'shop', 'WITH gone AS (SELECT 1) DELETE FROM orders', { schema: null, limit: 10 }))
        ).not.toBeNull();
        expect(await refusedWith(agents.execute(place, 'chat-1', 'shop', 'DELETE FROM orders', null))).toBe('database-write-off');
        expect((await agents.query(place, 'chat-1', 'shop', 'SELECT COUNT(*) AS n FROM orders', { schema: null, limit: 1 })).result.rows).toEqual([[4]]);

        await access.set('p1', 'shop', 'write');
        const executed = await agents.execute(place, 'chat-1', 'shop', 'DELETE FROM orders WHERE total < 1000; SELECT COUNT(*) AS n FROM orders', null);
        expect(executed.results.map((result) => result.kind)).toEqual(['done', 'rows']);
        expect(executed.results[0]).toMatchObject({ affected: 2 });
        expect(executed.results[1]).toMatchObject({ rows: [[2]] });
    });

    test('a released client has no session left', async () => {
        const { session } = await ok<{ session: string }>(call(service, 'client-3', 'open', { connection: { engine: 'sqlite', path } }));
        await service.release('client-3');
        expect(await call(service, 'client-3', 'tables', { session, schema: 'main' })).toMatchObject({ ok: false, error: { code: 'unknown-session' } });
    });
});

describe.skipIf(!MYSQL_URL || databaseHelperPath() === null)('the database helper on MySQL or MariaDB', () => {
    const url = new URL(MYSQL_URL ?? 'mysql://localhost');
    const database = decodeURIComponent(url.pathname.slice(1));
    const account = { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database };
    const table = `ruimte_it_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    let root: string;
    let service: DatabaseService;
    let session: string;

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'database-')));
        service = new DatabaseService({ machineHome: new MachineHome(join(root, 'home')) });
        const connection = { engine: 'mysql', host: url.hostname, port: Number(url.port || 3306), ...account };
        ({ session } = await ok<{ session: string }>(call(service, 'client-1', 'open', { connection })));
    });

    afterAll(async () => {
        await call(service, 'client-1', 'execute', { session, sql: `DROP TABLE IF EXISTS \`${database}\`.\`${table}\`` });
        await service.dispose();
        await rm(root, { recursive: true, force: true });
    });

    test('reads the schemas and tables of the server', async () => {
        const { schemas } = await ok<{ schemas: { name: string }[] }>(call(service, 'client-1', 'schemas', { session }));
        expect(schemas.map((schema) => schema.name)).toContain(database);
        const { tables } = await ok<{ tables: { name: string }[] }>(call(service, 'client-1', 'tables', { session, schema: database }));
        expect(tables.length).toBeGreaterThan(0);
    });

    test('creates a table of its own, applies changes and reads them back', async () => {
        await ok(
            call(service, 'client-1', 'execute', {
                session,
                schema: database,
                sql: `CREATE TABLE \`${table}\` (id INT PRIMARY KEY AUTO_INCREMENT, label VARCHAR(40) NOT NULL)`
            })
        );
        const applied = await ok<{ affected: number }>(
            call(service, 'client-1', 'apply', {
                session,
                schema: database,
                table,
                changes: [
                    { kind: 'insert', values: { label: 'first' } },
                    { kind: 'insert', values: { label: 'second' } }
                ]
            })
        );
        expect(applied.affected).toBe(2);
        await ok(call(service, 'client-1', 'apply', { session, schema: database, table, changes: [{ kind: 'delete', key: { id: 1 } }] }));

        const { rows } = await ok<{ rows: unknown[][] }>(call(service, 'client-1', 'rows', { session, schema: database, table, offset: 0, limit: 10 }));
        expect(rows).toEqual([[2, 'second']]);
        const { count } = await ok<{ count: number }>(call(service, 'client-1', 'count', { session, schema: database, table }));
        expect(count).toBe(1);
    });

    test('an agent finds the last orders over 1000 with the password a client handed over, and writes only where allowed', async () => {
        const home = join(root, 'agent-home');
        const config = { engine: 'mysql' as const, host: url.hostname, port: Number(url.port || 3306), user: account.user, database };
        const place: DatabasePlace = { projectId: 'p1', folder: root };
        const { agents, access } = await agentDatabases(service, home, [{ id: 'db', name: 'Test database', shared: true, config }]);

        if (account.password !== '') {
            expect(await refusedWith(agents.tables(place, 'chat-1', 'db', null))).toBe('database-locked');
            await agents.handPasswords('p1', 'client-1', { db: account.password });
        }
        const listed = await agents.tables(place, 'chat-1', 'db', null);
        expect(listed.tables.map((table) => table.name)).toContain('orders');

        const sql = 'SELECT id, total, placed_at FROM orders WHERE total > 1000 ORDER BY placed_at DESC';
        const query = await agents.query(place, 'chat-1', 'db', sql, { schema: null, limit: 10 });
        const direct = await ok<{ results: { rows: Cell[][] }[] }>(call(service, 'client-1', 'execute', { session, sql: `${sql} LIMIT 10` }));
        expect(query.result.rows).toEqual(direct.results[0]!.rows);
        expect(query.result.rows).toHaveLength(10);
        // The statement's own ORDER BY holds: these are the newest orders, newest first, and no LIMIT was added to get them.
        const placed = query.result.rows.map((row) => String(row[2]));
        expect(placed).toEqual([...placed].sort().reverse());
        expect(query.result.hasMore).toBe(true);
        expect(query.result.rows.every((row) => Number(row[1]) > 1000)).toBe(true);

        expect(await refusedWith(agents.query(place, 'chat-1', 'db', `DROP TABLE \`${table}\``, { schema: null, limit: 10 }))).toBe('unsupported');
        const own = `${table}_agent`;
        expect(await refusedWith(agents.execute(place, 'chat-1', 'db', `CREATE TABLE \`${own}\` (id INT PRIMARY KEY)`, null))).toBe('database-write-off');

        await access.set('p1', 'db', 'write');
        try {
            const executed = await agents.execute(
                place,
                'chat-1',
                'db',
                `CREATE TABLE \`${own}\` (id INT PRIMARY KEY); INSERT INTO \`${own}\` VALUES (1), (2); SELECT COUNT(*) AS n FROM \`${own}\``,
                null
            );
            expect(executed.results.map((result) => result.kind)).toEqual(['done', 'done', 'rows']);
            expect(executed.results[1]).toMatchObject({ affected: 2 });
        } finally {
            await agents.execute(place, 'chat-1', 'db', `DROP TABLE IF EXISTS \`${own}\``, null);
        }
    });

    test('finds the container that serves the server and reaches it through a Docker tunnel', async () => {
        const { containers } = await ok<{ containers: { name: string; ports: { container: number; host: number | null }[] }[] }>(
            call(service, 'client-1', 'discover', { kind: 'docker' })
        );
        const port = Number(url.port || 3306);
        const served = containers.find((container) => container.ports.some((entry) => entry.host === port));
        expect(served).toBeDefined();

        const tunnel = { engine: 'mysql', host: '', ...account, tunnel: { kind: 'docker', container: served!.name } };
        const { session: tunneled } = await ok<{ session: string }>(call(service, 'client-2', 'open', { connection: tunnel }));
        const { tables } = await ok<{ tables: { name: string }[] }>(call(service, 'client-2', 'tables', { session: tunneled, schema: database }));
        expect(tables.length).toBeGreaterThan(0);
        await ok(call(service, 'client-2', 'close', { session: tunneled }));
    }, 30_000);
});
