import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection, ProjectContent, RuntimeMode } from '@ruimte/contracts';
import { DatabaseAccessStore } from '../database/agent-access.ts';
import { AgentDatabases, connectionTarget } from '../database/agent-databases.ts';
import { DatabasePasswords } from '../database/agent-passwords.ts';
import { DatabaseService } from '../database/database-service.ts';
import { FakeHelper, type FakeAnswer } from '../database/fake-helper.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import type { CanvasHost } from './host.ts';
import { SHOWN_LINE } from './visual-tools.ts';

const PAGE = {
    columns: [
        { name: 'id', type: 'INT', kind: 'integer' },
        { name: 'note', type: 'TEXT', kind: 'text' },
        { name: 'total', type: 'DECIMAL', kind: 'decimal' }
    ],
    rows: [
        [1, '<script>alert(1)</script>', '1234.50'],
        [2, null, '99.00'],
        [3, 'tab\there\nnew line', { kind: 'longText', preview: 'abc', length: 900 }]
    ],
    hasMore: true,
    elapsedMs: 1.25
};

const STRUCTURE = {
    schema: 'shop',
    name: 'orders',
    kind: 'table',
    columns: [
        { name: 'id', type: 'bigint', kind: 'integer', nullable: false, defaultValue: null, autoIncrement: true, generated: false, comment: null },
        { name: 'total', type: 'decimal(12,2)', kind: 'decimal', nullable: false, defaultValue: '0.00', autoIncrement: false, generated: false, comment: null },
        { name: 'customer_id', type: 'int', kind: 'integer', nullable: true, defaultValue: null, autoIncrement: false, generated: false, comment: null }
    ],
    primaryKey: ['id'],
    rowKey: ['id'],
    indexes: [
        { name: 'PRIMARY', columns: ['id'], unique: true, primary: true },
        { name: 'orders_customer', columns: ['customer_id'], unique: false, primary: false }
    ],
    foreignKeys: [
        {
            name: 'orders_customer_fk',
            columns: ['customer_id'],
            referencedSchema: 'shop',
            referencedTable: 'customers',
            referencedColumns: ['id'],
            onUpdate: null,
            onDelete: 'CASCADE'
        }
    ],
    ddl: null
};

let root: string;
let folder: string;
let helper: FakeHelper;
let service: DatabaseService;
let released: string[];
let connections: DatabaseConnection[];
let access: DatabaseAccessStore;
let passwords: DatabasePasswords;
let agents: AgentDatabases;
let mode: RuntimeMode;
let visualsOn: boolean;
let published: { title: string; html: string }[];
let script: (method: string, params: Record<string, unknown>) => FakeAnswer;
let host: CanvasHost;

const CONTENT: ProjectContent = {
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'chat', id: 'chat-1', name: 'Planner', node: {} },
        { kind: 'terminal', id: 'term-1', name: 'Shell', node: {} }
    ]
} as ProjectContent;

function shop(config: Record<string, unknown> = {}): DatabaseConnection {
    return { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: '127.0.0.1', user: 'root', database: 'shop', ...config } };
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-database-tools-')));
    folder = join(root, 'repo');
    await mkdir(join(folder, 'data'), { recursive: true });
    await writeFile(join(folder, 'data', 'local.sqlite'), '');
    await writeFile(join(root, 'elsewhere.sqlite'), '');
    await symlink(join(root, 'elsewhere.sqlite'), join(folder, 'data', 'linked.sqlite'));
    script = () => undefined;
    helper = new FakeHelper((method, params) => script(method, params));
    service = new DatabaseService({ machineHome: new MachineHome(join(root, 'home')), start: () => helper });
    released = [];
    connections = [
        shop({ password: 'written-in-the-file' }),
        { id: 'local', name: 'Local', shared: false, config: { engine: 'sqlite', path: join(folder, 'data', 'local.sqlite') } },
        { id: 'away', name: 'Away', shared: false, config: { engine: 'sqlite', path: join(root, 'elsewhere.sqlite') } },
        { id: 'linked', name: 'Linked', shared: false, config: { engine: 'sqlite', path: join(folder, 'data', 'linked.sqlite') } }
    ];
    access = new DatabaseAccessStore(join(root, 'home'));
    await access.load();
    passwords = new DatabasePasswords();
    agents = new AgentDatabases({
        service: {
            handle: (request, owner) => service.handle(request, owner),
            release: (owner) => {
                released.push(owner);
                return service.release(owner);
            }
        },
        connections: { connectionsOf: async () => connections },
        projects: { holdersOf: () => ['client-1'] },
        access,
        passwords,
        scratchFolder: join(root, 'home', 'scratch')
    });
    mode = 'auto';
    visualsOn = true;
    published = [];
    host = {
        projects: {
            locate: (id: string) => (id === 'chat-1' || id === 'term-1' ? { projectId: 'p1', folder, canvasId: null } : null),
            read: async () => CONTENT
        },
        starts: { modeOf: () => mode },
        databases: agents,
        visuals: {
            enabled: () => visualsOn,
            publish: async (_chatId: string, input: { title: string; html: string }) => {
                published.push(input);
                return { id: 'visual-1', title: input.title, at: 0, maxHeight: 2000, size: input.html.length };
            },
            list: async () => [],
            remove: async () => []
        }
    } as unknown as CanvasHost;
});

afterEach(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
});

async function run(tool: string, input: Record<string, unknown> = {}, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer(tool, input, toolCall(caller, host))).lines;
}

function opened(): Record<string, unknown>[] {
    return helper.written.filter((message) => message.method === 'open').map((message) => message.params.connection as Record<string, unknown>);
}

describe('database tools', () => {
    test('lists the connections with where they point and what agents may do, never a password', async () => {
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        const lines = await run('database_list');
        expect(lines).toEqual([
            'shop\tShop\tmysql\troot@127.0.0.1:3306/shop\tread',
            `local\tLocal\tsqlite\t${join(folder, 'data', 'local.sqlite')}\twrite`,
            `away\tAway\tsqlite\t${join(root, 'elsewhere.sqlite')}\toutside-project`,
            `linked\tLinked\tsqlite\t${join(folder, 'data', 'linked.sqlite')}\toutside-project`
        ]);
        expect(lines.join('\n')).not.toContain('written-in-the-file');
    });

    test('a query runs through page on a session opened read only, and the call releases what it opened', async () => {
        script = (method) => (method === 'page' ? { result: PAGE } : undefined);
        const lines = await run('database_query', { connection: 'Local', sql: 'SELECT id, note, total FROM orders', limit: 3 });
        expect(lines).toEqual([
            'columns\tid\tnote\ttotal',
            'row\t1\t<script>alert(1)</script>\t1234.50',
            'row\t2\tNULL\t99.00',
            'row\t3\ttab\\there\\nnew line\tabc… [900 characters]',
            'rows\t3',
            'more\tThe result holds more rows than these 3; raise limit, at most 1000, or narrow the query',
            'elapsed\t1.3 ms'
        ]);
        expect(opened()).toEqual([{ engine: 'sqlite', path: join(folder, 'data', 'local.sqlite'), readOnly: true }]);
        const page = helper.written.find((message) => message.method === 'page')!;
        expect(page.params).toMatchObject({ sql: 'SELECT id, note, total FROM orders', offset: 0, limit: 3, cellLimit: 256 });
        expect(released).toHaveLength(1);
        expect(released[0]).toStartWith('agent:chat-1:');
        expect(helper.written.at(-1)).toMatchObject({ method: 'close', params: { session: 's1' } });
    });

    test('a failure of the server comes back under its own code with its words, and the session still goes', async () => {
        script = (method) => (method === 'page' ? { error: { code: 'query-failed', message: "Unknown column 'totl'", sqlState: '42S22' } } : undefined);
        expect(await run('database_query', { connection: 'local', sql: 'SELECT totl FROM orders' })).toEqual([
            "refused\tquery-failed\tUnknown column 'totl' (SQLSTATE 42S22)"
        ]);
        script = (method) => (method === 'page' ? { error: { code: 'unsupported', message: 'Only a statement that reads can be paged' } } : undefined);
        expect((await run('database_query', { connection: 'local', sql: 'DELETE FROM orders' }))[0]).toBe(
            'refused\tunsupported\tOnly a statement that reads can be paged'
        );
        expect(released).toHaveLength(2);
    });

    test('show puts the rows as an escaped table above the reply', async () => {
        script = (method) => (method === 'page' ? { result: PAGE } : undefined);
        const lines = await run('database_query', { connection: 'shop', sql: 'SELECT 1', show: 'Orders above 1000' });
        expect(lines.slice(-2)).toEqual([`visual\tvisual-1\tOrders above 1000\t${published[0]!.html.length} bytes`, SHOWN_LINE]);
        const { title, html } = published[0]!;
        expect(title).toBe('Orders above 1000');
        expect(html).toContain('<td>&#60;script&#62;alert(1)&#60;/script&#62;</td>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('<th class="number">id</th>');
        expect(html).toContain('<td class="number">1234.50</td>');
        expect(html).toContain('<td class="null">NULL</td>');
        expect(html).toContain('position:sticky');
        expect(html).toContain('<p>3 rows from shop on Shop, and more in the database</p>');
    });

    test('show leaves the table out with a note when visual replies are off, or the caller has no thread', async () => {
        script = (method) => (method === 'page' ? { result: PAGE } : undefined);
        visualsOn = false;
        const off = await run('database_query', { connection: 'shop', sql: 'SELECT 1', show: 'Orders' });
        expect(off.at(-1)).toStartWith('note\tThe table was not shown: A person turned visual replies off on this machine');
        expect(off).toContain('rows\t3');
        visualsOn = true;
        const terminal = await run('database_query', { connection: 'shop', sql: 'SELECT 1', show: 'Orders' }, 'term-1');
        expect(terminal.at(-1)).toStartWith('note\tThe table was not shown: A visual shows only in the thread of an AI chat');
        expect(published).toEqual([]);
    });

    test('execute writes only on a connection a person set to write, and never in supervised', async () => {
        script = (method) =>
            method === 'execute'
                ? {
                      result: {
                          results: [
                              { kind: 'done', sql: 'UPDATE orders SET total = 0 WHERE id = 1', affected: 1, lastInsertId: null, elapsedMs: 2 },
                              {
                                  kind: 'rows',
                                  sql: 'SELECT id FROM orders',
                                  columns: [{ name: 'id', type: 'INT', kind: 'integer' }],
                                  rows: [[1]],
                                  hasMore: false,
                                  elapsedMs: 1
                              }
                          ],
                          inTransaction: false
                      }
                  }
                : undefined;
        const sql = { connection: 'local', sql: 'UPDATE orders SET total = 0 WHERE id = 1; SELECT id FROM orders' };
        expect((await run('database_execute', sql))[0]).toStartWith('refused\tdatabase-write-off\tAgents may only read Local;');
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        mode = 'supervised';
        expect((await run('database_execute', sql))[0]).toStartWith('refused\tdatabase-write-mode\tYou run in supervised');
        expect(opened()).toEqual([]);
        mode = 'auto-accept-edits';
        expect(await run('database_execute', sql)).toEqual([
            'statement\t1\tUPDATE orders SET total = 0 WHERE id = 1',
            'done\t1',
            'elapsed\t2 ms',
            'statement\t2\tSELECT id FROM orders',
            'columns\tid',
            'row\t1',
            'rows\t1',
            'elapsed\t1 ms'
        ]);
        expect(opened()).toEqual([{ engine: 'sqlite', path: join(folder, 'data', 'local.sqlite') }]);
        expect(released).toHaveLength(1);
    });

    test('a statement that fails ends execute with its code and what ran before it', async () => {
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        script = (method) =>
            method === 'execute'
                ? {
                      result: {
                          results: [
                              { kind: 'done', sql: 'INSERT INTO t VALUES (1)', affected: 1, lastInsertId: 7, elapsedMs: 1 },
                              {
                                  kind: 'error',
                                  sql: 'INSERT INTO nope VALUES (1)',
                                  error: { code: 'query-failed', message: 'no such table: nope' },
                                  elapsedMs: 0
                              }
                          ],
                          inTransaction: true
                      }
                  }
                : undefined;
        expect(await run('database_execute', { connection: 'local', sql: 'INSERT INTO t VALUES (1); INSERT INTO nope VALUES (1)' })).toEqual([
            'refused\tquery-failed\tStatement 2 failed: no such table: nope',
            'statement\t1\tINSERT INTO t VALUES (1)',
            'done\t1\tlast-insert-id\t7',
            'elapsed\t1 ms',
            'statement\t2\tINSERT INTO nope VALUES (1)',
            'note\tThe statements before it ran; the ones after it did not'
        ]);
    });

    test('a connection a person turned off refuses every action, and a file outside the project is never opened', async () => {
        await agents.setAccess('p1', 'shop', 'off', 'client-1', true);
        expect((await run('database_tables', { connection: 'shop' }))[0]).toStartWith('refused\tdatabase-access-off\tA person turned Shop off for agents');
        expect((await run('database_query', { connection: 'away', sql: 'SELECT 1' }))[0]).toStartWith('refused\tdatabase-outside-project\t');
        expect((await run('database_describe', { connection: 'linked', table: 'orders' }))[0]).toStartWith('refused\tdatabase-outside-project\t');
        expect(opened()).toEqual([]);
    });

    test('a server is opened with the password a client handed over for exactly where it points', async () => {
        script = (method, params) => {
            const connection = params.connection as { password?: string } | undefined;
            if (method === 'open' && connection?.password !== 'hunter2') {
                return { error: { code: 'auth-failed', message: "Access denied for user 'root'" } };
            }
            return method === 'tables' ? { result: { tables: [{ name: 'orders', kind: 'table', rowEstimate: 12000, comment: null }] } } : undefined;
        };
        connections = [shop()];
        expect((await run('database_tables', { connection: 'shop' }))[0]).toStartWith(
            'refused\tdatabase-locked\tShop needs a password this machine does not have;'
        );

        await agents.handPasswords('p1', 'client-1', { shop: 'hunter2' });
        script = (
            (previous) => (method: string, params: Record<string, unknown>) =>
                method === 'schemas'
                    ? {
                          result: {
                              schemas: [
                                  { name: 'shop', system: false },
                                  { name: 'mysql', system: true }
                              ]
                          }
                      }
                    : previous(method, params)
        )(script);
        expect(await run('database_tables', { connection: 'shop' })).toEqual(['schema\tshop', 'table\tshop\torders\ttable\t12000']);

        connections = [shop({ host: 'evil.example.com' })];
        expect((await run('database_tables', { connection: 'shop' }))[0]).toStartWith('refused\tdatabase-locked\t');
        expect(opened().at(-1)).not.toHaveProperty('password');
        expect(passwords.passwordOf('p1', 'shop', connectionTarget(shop().config))).toBe('hunter2');
    });

    test('the passwords go once the last client lets the project go', async () => {
        connections = [shop()];
        await agents.handPasswords('p1', 'client-1', { shop: 'hunter2' });
        agents.letGo('p1');
        expect(passwords.passwordOf('p1', 'shop', connectionTarget(shop().config))).toBe('hunter2');
        const alone = new AgentDatabases({
            service,
            connections: { connectionsOf: async () => connections },
            projects: { holdersOf: () => [] },
            access,
            passwords,
            scratchFolder: join(root, 'home', 'scratch')
        });
        alone.letGo('p1');
        expect(passwords.passwordOf('p1', 'shop', connectionTarget(shop().config))).toBeNull();
    });

    test('describes a table with its columns, keys, indexes and foreign keys', async () => {
        script = (method) => (method === 'structure' ? { result: STRUCTURE } : undefined);
        expect(await run('database_describe', { connection: 'local', table: 'orders' })).toEqual([
            'table\tshop\torders\ttable',
            'column\tid\tbigint\tnot-null\t-\tprimary-key,auto-increment',
            'column\ttotal\tdecimal(12,2)\tnot-null\t0.00\t-',
            'column\tcustomer_id\tint\tnull\t-\t-',
            'primary\tid',
            'index\torders_customer\tindex\tcustomer_id',
            'foreign\torders_customer_fk\tcustomer_id\tshop.customers(id)\t-\tCASCADE'
        ]);
        expect(helper.written.find((message) => message.method === 'structure')?.params).toMatchObject({ schema: 'main', table: 'orders' });
    });

    test('names the connections there are for one it does not know, and refuses in the Chats project', async () => {
        expect(await run('database_tables', { connection: 'nope' })).toEqual([
            'refused\tunknown-connection\tThis project has no database connection nope',
            'connection\tshop\tShop',
            'connection\tlocal\tLocal',
            'connection\taway\tAway',
            'connection\tlinked\tLinked'
        ]);
        host = { ...host, projects: { ...host.projects, locate: () => ({ projectId: 'scratch', folder: join(root, 'home', 'scratch'), canvasId: null }) } };
        expect((await run('database_list'))[0]).toStartWith('refused\tdatabase-no-project\tYou are a chat in the Chats project');
    });
});

describe('UI database access', () => {
    const place = () => ({ projectId: 'p1', folder });
    test('an originally denied connection stays denied after a later grant', async () => {
        await agents.setAccess('p1', 'local', 'off', 'client-1', true);
        const grants = await agents.captureUiAccess(place());
        await agents.setAccess('p1', 'local', 'read', 'client-1', true);
        await expect(agents.authorizeUiRead(place(), 'local', grants)).rejects.toThrow('not readable');
    });
    test('a changed target or a connection added later cannot use the captured rights', async () => {
        const grants = await agents.captureUiAccess(place());
        connections[0] = shop({ host: 'other.example' });
        await expect(agents.authorizeUiRead(place(), 'shop', grants)).rejects.toThrow('not readable');
        connections.push({ id: 'new', name: 'New', shared: true, config: { engine: 'sqlite', path: join(folder, 'data', 'local.sqlite') } });
        await expect(agents.authorizeUiRead(place(), 'new', grants)).rejects.toThrow('not readable');
    });
    test('a captured target must be the fingerprint, never the connection target itself', async () => {
        const grants = await agents.captureUiAccess(place());
        const raw = grants.map((grant) =>
            grant.id === 'local' ? { ...grant, target: connectionTarget(connections.find((entry) => entry.id === 'local')!.config) } : grant
        );
        await expect(agents.authorizeUiRead(place(), 'local', raw)).rejects.toThrow('not readable');
        await agents.authorizeUiRead(place(), 'local', grants);
    });
    test('a live read requires the in-memory password even when a stored file contains one', async () => {
        const grants = await agents.captureUiAccess(place());
        await expect(agents.authorizeUiRead(place(), 'shop', grants)).rejects.toThrow('password');
        passwords.hand('p1', 'client-1', [{ connectionId: 'shop', target: connectionTarget(connections[0]!.config), password: 'secret' }]);
        await agents.authorizeUiRead(place(), 'shop', grants);
        passwords.forget('p1');
        await expect(agents.authorizeUiRead(place(), 'shop', grants)).rejects.toThrow('password');
    });
    test('the read itself rechecks its captured target and current access', async () => {
        const grants = await agents.captureUiAccess(place());
        await agents.setAccess('p1', 'local', 'off', 'client-1', true);
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, uiAccess: grants })).rejects.toThrow('off');
        await agents.setAccess('p1', 'local', 'read', 'client-1', true);
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, uiAccess: [] })).rejects.toThrow('not readable');
    });
    test('an aborted UI read never opens a helper session', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, signal: controller.signal })).rejects.toThrow('stopped');
        expect(helper.written).toEqual([]);
    });
});

describe('a write grant follows where the connection points', () => {
    const write = { connection: 'local', sql: 'DELETE FROM orders' };

    function point(id: string, config: Record<string, unknown>): void {
        const index = connections.findIndex((connection) => connection.id === id);
        connections[index] = { ...connections[index]!, config: { ...connections[index]!.config, ...config } as DatabaseConnection['config'] };
    }

    async function levelOf(id: string): Promise<string> {
        return agents.levelOf(
            'p1',
            connections.find((connection) => connection.id === id)!
        );
    }

    test('a SQLite file pointed elsewhere in the project loses the grant, also once pointed back', async () => {
        await writeFile(join(folder, 'data', 'other.sqlite'), '');
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        point('local', { path: join(folder, 'data', 'other.sqlite') });
        expect((await run('database_execute', write))[0]).toStartWith('refused\tdatabase-write-off\t');
        expect(opened()).toEqual([]);
        expect(await agents.accessFor('p1', 'client-1')).toEqual({ access: {} });

        await agents.connectionsChanged('p1', connections);
        point('local', { path: join(folder, 'data', 'local.sqlite') });
        await agents.connectionsChanged('p1', connections);
        expect((await run('database_execute', write))[0]).toStartWith('refused\tdatabase-write-off\t');
    });

    test('a link whose file changes under the same path loses the grant', async () => {
        await writeFile(join(folder, 'data', 'other.sqlite'), '');
        await symlink(join(folder, 'data', 'local.sqlite'), join(folder, 'data', 'current.sqlite'));
        point('local', { path: join(folder, 'data', 'current.sqlite') });
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        expect(await levelOf('local')).toBe('write');
        await rm(join(folder, 'data', 'current.sqlite'));
        await symlink(join(folder, 'data', 'other.sqlite'), join(folder, 'data', 'current.sqlite'));
        expect(await levelOf('local')).toBe('read');
    });

    test('a server loses the grant with another host, port, user, tunnel or database, and keeps it with a new password', async () => {
        await agents.setAccess('p1', 'shop', 'write', 'client-1', true);
        expect(await levelOf('shop')).toBe('write');
        point('shop', { password: 'another' });
        expect(await levelOf('shop')).toBe('write');
        const changes: Record<string, unknown>[] = [
            { host: 'db.example' },
            { port: 3307 },
            { user: 'admin' },
            { tunnel: { kind: 'ssh', host: 'jump.example', user: 'me' } },
            { database: 'other' }
        ];
        for (const change of changes) {
            const before = connections[0]!;
            point('shop', change);
            expect(await levelOf('shop')).toBe('read');
            connections[0] = before;
            expect(await levelOf('shop')).toBe('write');
        }
    });

    test('a connection removed and made again under the same id does not get its grant back', async () => {
        await agents.setAccess('p1', 'local', 'write', 'client-1', true);
        const heard: unknown[] = [];
        agents.subscribe('client-1', (event) => heard.push(event));
        const local = connections.splice(1, 1)[0]!;
        await agents.connectionsChanged('p1', connections);
        expect(heard).toEqual([{ event: 'database.agentAccess.changed', payload: { projectId: 'p1', access: {} } }]);
        connections.splice(1, 0, local);
        await agents.connectionsChanged('p1', connections);
        expect(heard).toHaveLength(1);
        expect(await levelOf('local')).toBe('read');
        expect((await run('database_execute', write))[0]).toStartWith('refused\tdatabase-write-off\t');
    });

    test('a write is granted only for a connection the project has, and only by the local secret', async () => {
        await expect(agents.setAccess('p1', 'gone', 'write', 'client-1', true)).rejects.toThrow('no database connection gone');
        await expect(agents.setAccess('p1', 'local', 'write', 'client-1', false)).rejects.toThrow('Only a person on this machine');
        expect(await agents.setAccess('p1', 'gone', 'off', 'client-1', false)).toEqual({ access: {} });
    });
});

test('UI access snapshots contain connection fingerprints, never target configuration', async () => {
    const grants = await agents.captureUiAccess({ projectId: 'p1', folder });
    expect(grants[0]!.target).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(grants)).not.toContain('127.0.0.1');
    expect(JSON.stringify(grants)).not.toContain('written-in-the-file');
});
