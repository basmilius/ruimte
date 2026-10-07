import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection, LanguageRequestResult, ProjectContent } from '@ruimte/contracts';
import type { Diagnostic, Position } from '@adecore/lsp';
import { DatabaseService, databaseHelperPath } from '../database/database-service.ts';
import { SchemaSnapshots } from '../database/schema-snapshots.ts';
import { SqlAnalysis } from '../database/sql-analysis.ts';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { AgentLanguage } from './agent-language.ts';
import { LanguageHost } from './host.ts';
import { cargoCommand, NativePolicy, phpLanguageServerCheckout, sqlLanguageServerCheckout, type Download } from './native.ts';
import { spawnLanguageProcess } from './runtime.ts';
import { tarGz } from './test-archives.ts';

/*
 * The SQL server and the SQL in the strings of the PHP server, built from their checkouts as Install does
 * in development, read against a snapshot the daemon takes of a real SQLite file through the database helper,
 * and of MariaDB or MySQL at `RUIMTE_TEST_MYSQL_URL` (`mysql://user:password@host:port/database`) when it is set,
 * where only a table of this test's own is made.
 */

const sqlCheckout = sqlLanguageServerCheckout(false);
const phpCheckout = phpLanguageServerCheckout(false);
const hasCargo = existsSync(cargoCommand());
const helper = databaseHelperPath();
const ready = hasCargo && sqlCheckout !== null && phpCheckout !== null && helper !== null;

if (!ready) {
    console.warn('Skipping the SQL server tests: they need cargo, both language server checkouts and the database helper');
}

const STUBS = tarGz([{ path: 'stubs/standard/standard_0.php', text: '<?php\n\nfunction strlen(string $string): int {}\n' }]);

const download: Download = async (_url, destination) => {
    await writeFile(destination, STUBS);
};

const QUERY = 'SELECT emial FROM users;\n';

const MYSQL_URL = process.env.RUIMTE_TEST_MYSQL_URL;

const PHP = ['<?php', '', 'function find(PDO $pdo): void', '{', "    $pdo->query('SELECT emial FROM users WHERE id = 1');", '}', ''].join('\n');

let base = '';
let project = '';
let host: LanguageHost;
let analysis: SqlAnalysis;
let service: DatabaseService;
let content: ProjectContent = { name: 'Shop', color: '#000', views: [] };
let connections: DatabaseConnection[] = [];
const passwords: Record<string, string> = {};
const events: SessionEvent[] = [];
const exits: Promise<unknown>[] = [];

async function eventually<T>(what: string, run: () => Promise<T> | T, accept: (value: T) => boolean = Boolean, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
        try {
            const value = await run();
            if (accept(value)) {
                return value;
            }
            last = value;
        } catch (error) {
            last = error;
        }
        await Bun.sleep(100);
    }
    throw new Error(`${what} never happened (last: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 400)})`);
}

function positionOf(text: string, needle: string, offset = 0): Position {
    const index = text.indexOf(needle) + offset;
    const before = text.slice(0, index).split('\n');
    return { line: before.length - 1, character: before[before.length - 1]!.length };
}

const ask = (path: string, method: string, params: unknown): Promise<LanguageRequestResult> =>
    host.request({ projectId: 'p1', path, method: method as never, params });

function diagnosticsOf(path: string, server: string): Diagnostic[] {
    const report = events.findLast((event) => event.event === 'language.diagnostics' && event.payload.path === path && event.payload.server === server);
    return report && report.event === 'language.diagnostics' ? (report.payload.diagnostics as Diagnostic[]) : [];
}

describe.skipIf(!ready)('the SQL servers against a snapshot of the project database', () => {
    let connection: DatabaseConnection;

    beforeAll(async () => {
        base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-sql-server-')));
        project = join(base, 'project');
        await mkdir(join(project, 'queries'), { recursive: true });
        await writeFile(join(project, 'queries', 'users.sql'), QUERY);
        await writeFile(join(project, 'find.php'), PHP);
        await writeFile(join(project, 'composer.json'), JSON.stringify({ name: 'acme/shop', require: { php: '^8.3' } }));
        const home = join(base, 'home');
        service = new DatabaseService({ machineHome: new MachineHome(home) });
        const file = join(project, 'shop.sqlite');
        const owner = 'setup';
        const opened = await service.handle({ id: 'o', method: 'open', params: { connection: { engine: 'sqlite', path: file, create: true } } }, owner);
        if (!opened.ok) {
            throw new Error(opened.error.message);
        }
        const session = (opened.result as { session: string }).session;
        const made = await service.handle(
            {
                id: 'e',
                method: 'execute',
                params: {
                    session,
                    sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT); CREATE INDEX users_email ON users (email);"
                }
            },
            owner
        );
        if (!made.ok) {
            throw new Error(made.error.message);
        }
        await service.release(owner);
        connection = { id: 'shop', name: 'Shop', shared: false, config: { engine: 'sqlite', path: file } };
        connections = [connection];
        analysis = new SqlAnalysis({
            projects: {
                folderOf: (projectId) => (projectId === 'p1' ? project : null),
                holdersOf: () => ['c1'],
                read: async () => content,
                mutate: async (_projectId, apply) => {
                    const mutation = await apply(content);
                    if (mutation.content !== null) {
                        content = mutation.content;
                    }
                    return mutation.result;
                }
            },
            connections: { connectionsOf: async () => connections },
            snapshots: new SchemaSnapshots({
                root: join(home, 'database-snapshots'),
                service,
                passwordOf: (_projectId, connectionId) => passwords[connectionId] ?? null
            }),
            access: { levelOf: () => 'read' }
        });
        host = new LanguageHost({
            root: join(home, 'language-servers'),
            folderOf: (projectId) => (projectId === 'p1' ? project : null),
            holders: () => ['c1'],
            machineHome: new MachineHome(home),
            native: new NativePolicy({ checkouts: { 'php-native': phpCheckout, 'sql-native': sqlCheckout } }),
            download,
            sqlSettings: (projectId) => analysis.settingsOf(projectId),
            spawn: (spec) => {
                const child = spawnLanguageProcess(spec);
                exits.push(child.exited);
                return child;
            }
        });
        analysis.attach(host);
        host.subscribe('c1', (event) => events.push(event));
        analysis.subscribe('c1', (event) => events.push(event));
        await host.install('sql-native');
        await host.install('php-native');
    }, 900_000);

    afterAll(async () => {
        await host?.close();
        await service?.dispose();
        await Promise.all(exits);
        await rm(base, { recursive: true, force: true });
    });

    test('a file bound to the connection is read against its snapshot', async () => {
        const state = await analysis.bind('p1', 'queries/users.sql', { connectionId: 'shop' }, 'c1');
        expect(state.sql.files).toEqual({ 'queries/users.sql': { connectionId: 'shop' } });
        await analysis.refresh('p1', 'c1', 'shop');
        const snapshots = (await analysis.state('p1', 'c1')).snapshots;
        expect(snapshots).toEqual([expect.objectContaining({ connectionId: 'shop', database: 'main', dialect: 'sqlite', tables: 1 })]);

        const opened = await host.open('c1', { projectId: 'p1', path: 'queries/users.sql', languageId: 'sql', text: QUERY });
        expect(opened.servers).toEqual(['sql-native']);
        const unknown = await eventually(
            'the unknown column',
            () => diagnosticsOf('queries/users.sql', 'sql-native'),
            (list) => list.some((item) => item.message.includes('emial'))
        );
        expect(unknown.find((item) => item.message.includes('emial'))?.code).toBe('unresolved-column');

        const completion = await eventually(
            'the columns of users',
            () => ask('queries/users.sql', 'textDocument/completion', { position: positionOf(QUERY, 'emial', 1) }),
            (reply) => JSON.stringify(reply.result).includes('"email"')
        );
        expect(JSON.stringify(completion.result)).toContain('"name"');
    }, 180_000);

    test('an agent reads the same diagnostics and the snapshot of the file', async () => {
        const agent = new AgentLanguage({ host, sql: analysis });
        const answer = await agent.diagnostics({ projectId: 'p1', folder: project }, 'chat-1', join(project, 'queries', 'users.sql'));
        expect(answer.diagnostics.some((item) => item.code === 'unresolved-column' && item.line === 1 && item.column === 8)).toBe(true);
        const file = await agent.sqlFile({ projectId: 'p1', folder: project }, join(project, 'queries', 'users.sql'));
        expect(file).toMatchObject({ source: 'file', connection: { id: 'shop' }, database: 'main', dialect: 'sqlite' });
        expect(file.command).toContain('--schema');
    }, 120_000);

    test('none takes the schema away from the file at once', async () => {
        await analysis.bind('p1', 'queries/users.sql', { connectionId: null }, 'c1');
        await eventually(
            'the column no longer reported',
            () => diagnosticsOf('queries/users.sql', 'sql-native'),
            (list) => !list.some((item) => item.message.includes('emial'))
        );
    }, 120_000);

    test('the SQL in a PHP string is read against the project default', async () => {
        await analysis.bind('p1', undefined, { connectionId: 'shop' }, 'c1');
        await host.open('c1', { projectId: 'p1', path: 'find.php', languageId: 'php', text: PHP });
        const problems = await eventually(
            'the unknown column in the string',
            () => diagnosticsOf('find.php', 'php-native'),
            (list) => list.some((item) => item.source === 'sql' && item.message.includes('emial')),
            120_000
        );
        expect(problems.find((item) => item.source === 'sql')?.code).toBe('unresolved-column');
    }, 180_000);

    test.skipIf(MYSQL_URL === undefined)(
        'a server connection reads as the product that answered, MariaDB or MySQL',
        async () => {
            const url = new URL(MYSQL_URL ?? 'mysql://localhost');
            const database = decodeURIComponent(url.pathname.slice(1));
            const table = `ruimte_sql_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
            const config = { engine: 'mysql', host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), database };
            passwords.server = decodeURIComponent(url.password);
            connections = [...connections, { id: 'server', name: 'Server', shared: false, config: config as DatabaseConnection['config'] }];
            const owner = 'mysql-setup';
            const opened = await service.handle({ id: 'm1', method: 'open', params: { connection: { ...config, password: passwords.server } } }, owner);
            if (!opened.ok) {
                throw new Error(opened.error.message);
            }
            const session = (opened.result as { session: string; server: { flavor: string } }).session;
            const flavor = (opened.result as { server: { flavor: string } }).server.flavor;
            await service.handle(
                {
                    id: 'm2',
                    method: 'execute',
                    params: { session, sql: `CREATE TABLE ${table} (id INT PRIMARY KEY, total DECIMAL(10,2) NOT NULL COMMENT 'In euros')` }
                },
                owner
            );
            try {
                const text = `DELETE FROM ${table} WHERE totl > 10 RETURNING id;\n`;
                await writeFile(join(project, 'queries', 'server.sql'), text);
                await analysis.bind('p1', 'queries/server.sql', { connectionId: 'server' }, 'c1');
                await analysis.refresh('p1', 'c1', 'server');
                const snapshot = (await analysis.state('p1', 'c1')).snapshots.find((entry) => entry.connectionId === 'server');
                expect(snapshot).toMatchObject({ dialect: flavor, database });
                await host.open('c1', { projectId: 'p1', path: 'queries/server.sql', languageId: 'sql', text });
                const found = await eventually(
                    'the unknown column of the server table',
                    () => diagnosticsOf('queries/server.sql', 'sql-native'),
                    (list) => list.some((item) => item.message.includes('totl'))
                );
                // RETURNING after DELETE is MariaDB's and not MySQL's, so the dialect the snapshot names decides it.
                expect(found.some((item) => item.code === 'unsupported-syntax')).toBe(flavor !== 'mariadb');
            } finally {
                await service.handle({ id: 'm3', method: 'execute', params: { session, sql: `DROP TABLE ${table}` } }, owner);
                await service.release(owner);
            }
        },
        180_000
    );
});
