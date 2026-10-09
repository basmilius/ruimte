import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection, ProjectContent, RuntimeMode } from '@ruimte/contracts';
import { refusalBody } from '@adecore/agents/context/refusal';
import { DatabaseAccessStore } from '../database/agent-access.ts';
import { AgentDatabases, connectionTarget } from '../database/agent-databases.ts';
import { DatabasePasswords } from '../database/agent-passwords.ts';
import { DatabaseService } from '../database/database-service.ts';
import { FakeHelper, type FakeAnswer } from '../database/fake-helper.ts';
import { runContext } from '../cli/context.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { handleCanvasRequest } from './canvas-route.ts';
import { SHOWN_LINE } from './visual-verb.ts';
import { VerbRefusal, type CanvasHost, type Noun, type Verb } from './verb.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('database') as Noun;

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
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-database-verb-')));
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
        locate: (id: string) => (id === 'chat-1' || id === 'term-1' ? { projectId: 'p1', folder, canvasId: null } : null),
        read: async () => CONTENT,
        modeOf: () => mode,
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

async function run(argv: string[], caller = 'chat-1'): Promise<string[]> {
    try {
        return await noun.run(argv, { caller, host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

function opened(): Record<string, unknown>[] {
    return helper.written.filter((message) => message.method === 'open').map((message) => message.params.connection as Record<string, unknown>);
}

describe('ruimte-context database', () => {
    test('lists the connections with where they point and what agents may do, never a password', async () => {
        await access.set('p1', 'local', 'write');
        const lines = await run(['list']);
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
        const lines = await run(['query', 'Local', '--sql', 'SELECT id, note, total FROM orders', '--limit', '3']);
        expect(lines).toEqual([
            'columns\tid\tnote\ttotal',
            'row\t1\t<script>alert(1)</script>\t1234.50',
            'row\t2\tNULL\t99.00',
            'row\t3\ttab\\there\\nnew line\tabc… [900 characters]',
            'rows\t3',
            'more\tThe result holds more rows than these 3; raise --limit, at most 1000, or narrow the query',
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
        expect(await run(['query', 'local', '--sql', 'SELECT totl FROM orders'])).toEqual(["refused\tquery-failed\tUnknown column 'totl' (SQLSTATE 42S22)"]);
        script = (method) => (method === 'page' ? { error: { code: 'unsupported', message: 'Only a statement that reads can be paged' } } : undefined);
        expect((await run(['query', 'local', '--sql', 'DELETE FROM orders']))[0]).toBe('refused\tunsupported\tOnly a statement that reads can be paged');
        expect(released).toHaveLength(2);
    });

    test('--show puts the rows as an escaped table above the reply', async () => {
        script = (method) => (method === 'page' ? { result: PAGE } : undefined);
        const lines = await run(['query', 'shop', '--sql', 'SELECT 1', '--show', 'Orders above 1000']);
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

    test('--show leaves the table out with a note when visual replies are off, or the caller has no thread', async () => {
        script = (method) => (method === 'page' ? { result: PAGE } : undefined);
        visualsOn = false;
        const off = await run(['query', 'shop', '--sql', 'SELECT 1', '--show', 'Orders']);
        expect(off.at(-1)).toStartWith('note\tThe table was not shown: A person turned visual replies off on this machine');
        expect(off).toContain('rows\t3');
        visualsOn = true;
        const terminal = await run(['query', 'shop', '--sql', 'SELECT 1', '--show', 'Orders'], 'term-1');
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
        const sql = ['execute', 'local', '--sql', 'UPDATE orders SET total = 0 WHERE id = 1; SELECT id FROM orders'];
        expect((await run(sql))[0]).toStartWith('refused\tdatabase-write-off\tAgents may only read Local;');
        await access.set('p1', 'local', 'write');
        mode = 'supervised';
        expect((await run(sql))[0]).toStartWith('refused\tdatabase-write-mode\tYou run in supervised');
        expect(opened()).toEqual([]);
        mode = 'auto-accept-edits';
        expect(await run(sql)).toEqual([
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
        await access.set('p1', 'local', 'write');
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
        expect(await run(['execute', 'local', '--sql', 'INSERT INTO t VALUES (1); INSERT INTO nope VALUES (1)'])).toEqual([
            'refused\tquery-failed\tStatement 2 failed: no such table: nope',
            'statement\t1\tINSERT INTO t VALUES (1)',
            'done\t1\tlast-insert-id\t7',
            'elapsed\t1 ms',
            'statement\t2\tINSERT INTO nope VALUES (1)',
            'note\tThe statements before it ran; the ones after it did not'
        ]);
    });

    test('a connection a person turned off refuses every action, and a file outside the project is never opened', async () => {
        await access.set('p1', 'shop', 'off');
        expect((await run(['tables', 'shop']))[0]).toStartWith('refused\tdatabase-access-off\tA person turned Shop off for agents');
        expect((await run(['query', 'away', '--sql', 'SELECT 1']))[0]).toStartWith('refused\tdatabase-outside-project\t');
        expect((await run(['describe', 'linked', 'orders']))[0]).toStartWith('refused\tdatabase-outside-project\t');
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
        expect((await run(['tables', 'shop']))[0]).toStartWith('refused\tdatabase-locked\tShop needs a password this machine does not have;');

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
        expect(await run(['tables', 'shop'])).toEqual(['schema\tshop', 'table\tshop\torders\ttable\t12000']);

        connections = [shop({ host: 'evil.example.com' })];
        expect((await run(['tables', 'shop']))[0]).toStartWith('refused\tdatabase-locked\t');
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
        script = (method) => (method === 'structure' ? { result: STRUCTURE } : method === 'open' ? undefined : undefined);
        expect(await run(['describe', 'local', 'orders'])).toEqual([
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
        expect(await run(['tables', 'nope'])).toEqual([
            'refused\tunknown-connection\tThis project has no database connection nope',
            'connection\tshop\tShop',
            'connection\tlocal\tLocal',
            'connection\taway\tAway',
            'connection\tlinked\tLinked'
        ]);
        host = { ...host, locate: () => ({ projectId: 'scratch', folder: join(root, 'home', 'scratch'), canvasId: null }) } as CanvasHost;
        expect((await run(['list']))[0]).toStartWith('refused\tdatabase-no-project\tYou are a chat in the Chats project');
    });

    test('the CLI sends a query on stdin through the canvas route and prints the rows, and a refusal on stderr', async () => {
        script = (method) => (method === 'page' ? { result: { ...PAGE, rows: PAGE.rows.slice(0, 2), hasMore: false } } : undefined);
        let stdout = '';
        let stderr = '';
        const spies = [
            spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
                const request = new Request(input, init);
                return handleCanvasRequest(request, new URL(request.url).pathname, { targetForToken: (token) => (token === 'tok' ? 'chat-1' : null), host });
            }) as typeof fetch),
            spyOn(process.stdout, 'write').mockImplementation((chunk) => {
                stdout += String(chunk);
                return true;
            }),
            spyOn(process.stderr, 'write').mockImplementation((chunk) => {
                stderr += String(chunk);
                return true;
            })
        ];
        try {
            const env = { RUIMTE_CONTEXT_URL: 'http://daemon.test/context', RUIMTE_CONTEXT_TOKEN: 'tok' };
            expect(await runContext(['database', 'query', 'local'], env, async () => 'SELECT id, note, total\nFROM orders;\n')).toBe(0);
            expect(stdout).toBe(
                ['columns\tid\tnote\ttotal', 'row\t1\t<script>alert(1)</script>\t1234.50', 'row\t2\tNULL\t99.00', 'rows\t2', 'elapsed\t1.3 ms', ''].join('\n')
            );
            expect(helper.written.find((message) => message.method === 'page')?.params.sql).toBe('SELECT id, note, total\nFROM orders;');
            expect(await runContext(['database', 'execute', 'local', '--sql', 'DELETE FROM orders'], env)).toBe(3);
            expect(stderr).toStartWith('refused\tdatabase-write-off\t');
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
    });

    test('help explains when to use it and prints every action', async () => {
        const help = verbNamed('help') as Verb;
        const lines = await help.run(['database'], { caller: 'chat-1', host });
        expect(lines.some((line) => line.startsWith("when\tA question about the project's data"))).toBe(true);
        for (const action of ['list', 'tables', 'describe', 'query', 'execute']) {
            expect(lines.some((line) => line.includes(`database ${action}`))).toBe(true);
        }
        const query = await help.run(['database', 'query'], { caller: 'chat-1', host });
        expect(query.some((line) => line.startsWith('flag\t--show TITLE\toptional\tAlso shows the rows as a table above your reply'))).toBe(true);
    });
});

describe('UI database access', () => {
    const place = () => ({ projectId: 'p1', folder });
    test('an originally denied connection stays denied after a later grant', async () => {
        await access.set('p1', 'local', 'off');
        const grants = await agents.captureUiAccess(place());
        await access.set('p1', 'local', 'read');
        await expect(agents.authorizeUiRead(place(), 'local', grants)).rejects.toThrow('not readable');
    });
    test('a changed target or a connection added later cannot use the captured rights', async () => {
        const grants = await agents.captureUiAccess(place());
        connections[0] = shop({ host: 'other.example' });
        await expect(agents.authorizeUiRead(place(), 'shop', grants)).rejects.toThrow('not readable');
        connections.push({ id: 'new', name: 'New', shared: true, config: { engine: 'sqlite', path: join(folder, 'data', 'local.sqlite') } });
        await expect(agents.authorizeUiRead(place(), 'new', grants)).rejects.toThrow('not readable');
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
        await access.set('p1', 'local', 'off');
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, uiAccess: grants })).rejects.toThrow('off');
        await access.set('p1', 'local', 'read');
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, uiAccess: [] })).rejects.toThrow('original access');
    });
    test('an aborted UI read never opens a helper session', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(agents.query(place(), 'chat-1', 'local', 'SELECT 1', { schema: null, limit: 1, signal: controller.signal })).rejects.toThrow('stopped');
        expect(helper.written).toEqual([]);
    });
});
