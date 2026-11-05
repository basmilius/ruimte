import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection, LanguageRequestResult } from '@ruimte/contracts';
import { AgentLanguage, characterColumn, hoverText, locationsOf, symbolsOf, utf16Column } from './agent-language.ts';
import type { AgentDocument, LanguageHost } from './host.ts';
import type { SqlFileContext } from './sql-file-context.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: false, config: { engine: 'mysql', host: 'db', user: 'app', database: 'shop' } };

const PLACE = { projectId: 'p1', folder: '/work' };

const range = (line: number, character: number, endCharacter = character + 1) => ({ start: { line, character }, end: { line, character: endCharacter } });

describe('places as an agent writes them', () => {
    test('a column counts characters, which LSP counts in UTF-16', () => {
        expect(utf16Column('a😀b', 3)).toBe(3);
        expect(characterColumn('a😀b', 3)).toBe(3);
        expect(utf16Column('abc', 1)).toBe(0);
        expect(characterColumn('abc', 2)).toBe(3);
    });

    test('a hover in every shape a server answers with', () => {
        expect(hoverText('plain')).toBe('plain');
        expect(hoverText({ kind: 'markdown', value: '**users**' })).toBe('**users**');
        expect(hoverText([{ language: 'sql', value: 'id bigint' }, 'the id'])).toBe('```sql\nid bigint\n```\n\nthe id');
    });

    test('a definition as a location, a list or links', () => {
        expect(locationsOf({ uri: 'file:///a', range: range(0, 0) })).toEqual([{ uri: 'file:///a', range: range(0, 0) }]);
        expect(locationsOf([{ targetUri: 'file:///b', targetRange: range(1, 0, 9), targetSelectionRange: range(1, 4, 7) }])).toEqual([
            { uri: 'file:///b', range: range(1, 4, 7) }
        ]);
        expect(locationsOf(null)).toEqual([]);
    });

    test('symbols in reading order with how deep each sits, a tree or a flat list', () => {
        const tree = [
            {
                name: 'users',
                kind: 5,
                range: range(0, 0, 30),
                selectionRange: range(0, 13, 18),
                children: [{ name: 'email', kind: 8, detail: 'varchar(255)', range: range(1, 4, 9) }]
            }
        ];
        expect(symbolsOf(tree, 'CREATE TABLE users (\n    email varchar(255)\n);', 'a.sql')).toEqual([
            { name: 'users', kind: 'class', detail: null, depth: 0, line: 1, column: 14, endLine: 1, endColumn: 19 },
            { name: 'email', kind: 'field', detail: 'varchar(255)', depth: 1, line: 2, column: 5, endLine: 2, endColumn: 10 }
        ]);
        expect(symbolsOf([{ name: 'f', kind: 12, location: { range: range(0, 0) }, containerName: 'A' }], 'f', 'a.php')[0]).toMatchObject({
            kind: 'function',
            detail: 'A'
        });
    });
});

interface Rig {
    agent: AgentLanguage;
    asked: { method: string; params: object }[];
    context: SqlFileContext;
}

interface RigOptions {
    servers?: AgentDocument['servers'];
    answer?: unknown;
    /* The answer per method, for a call that asks twice. */
    answers?: Record<string, unknown>;
    context?: Partial<SqlFileContext>;
    text?: string;
    program?: string;
    workspace?: ReturnType<LanguageHost['cachedWorkspaceProblems']>;
}

function rig(options: RigOptions = {}): Rig {
    const asked: Rig['asked'] = [];
    const context: SqlFileContext = { choice: { source: 'default', connection: SHOP, database: 'shop' }, snapshot: null, access: 'read', ...options.context };
    const text = options.text ?? 'SELECT emial FROM users;\n';
    const agent = new AgentLanguage({
        host: {
            forAgent: async (_projectId, request, work) =>
                work({
                    storedPath: request.path.replace('/work/', ''),
                    absolutePath: request.path,
                    text,
                    unsaved: request.disk !== text,
                    servers: options.servers ?? [{ kind: 'sql-native', state: 'ready' }],
                    request: async (method, params) => {
                        asked.push({ method, params });
                        return {
                            result: options.answers?.[method] ?? options.answer ?? null,
                            server: 'sql-native',
                            version: 1
                        } satisfies LanguageRequestResult;
                    },
                    diagnostics: async () => [
                        {
                            server: 'sql-native',
                            diagnostics: [{ range: range(0, 7, 12), severity: 1, source: 'sql', code: 'unresolved-column', message: "Unknown column 'emial'" }]
                        }
                    ]
                }) as never,
            programOf: () => options.program ?? null,
            cachedWorkspaceProblems: () => options.workspace ?? { servers: [], pulled: true, files: 0, reports: [] }
        },
        sql: { fileContext: async () => context },
        readText: async () => text
    });
    return { agent, asked, context };
}

describe('the language tool of an agent', () => {
    test('diagnostics come back where they sit, with the server, the source and the code', async () => {
        const answer = await rig().agent.diagnostics(PLACE, 'chat-1', '/work/db/a.sql');
        expect(answer).toEqual({
            path: 'db/a.sql',
            unsaved: false,
            servers: [{ kind: 'sql-native', state: 'ready' }],
            diagnostics: [
                {
                    path: 'db/a.sql',
                    line: 1,
                    column: 8,
                    endLine: 1,
                    endColumn: 13,
                    severity: 'error',
                    server: 'sql-native',
                    source: 'sql',
                    code: 'unresolved-column',
                    message: "Unknown column 'emial'"
                }
            ]
        });
    });

    test('a position goes to the server in its own units, and the hover comes back as text', async () => {
        const { agent, asked } = rig({ answer: { contents: { kind: 'markdown', value: '**users**' } } });
        expect((await agent.hover(PLACE, 'chat-1', '/work/db/a.sql', { line: 1, column: 19 })).contents).toBe('**users**');
        expect(asked).toEqual([{ method: 'textDocument/hover', params: { position: { line: 0, character: 18 } } }]);
        await expect(agent.hover(PLACE, 'chat-1', '/work/db/a.sql', { line: 9, column: 1 })).rejects.toMatchObject({ code: 'bad-position' });
    });

    test('references ask for the declaration too', async () => {
        const { agent, asked } = rig({ answer: [{ uri: 'file:///work/db/a.sql', range: range(0, 18, 23) }] });
        const answer = await agent.references(PLACE, 'chat-1', '/work/db/a.sql', { line: 1, column: 19 });
        expect(answer.locations).toEqual([{ path: 'db/a.sql', line: 1, column: 19, endLine: 1, endColumn: 24 }]);
        expect(asked[0]!.params).toMatchObject({ context: { includeDeclaration: true } });
    });

    test('a file read against a connection a person turned off for agents is refused, as database refuses it', async () => {
        await expect(rig({ context: { access: 'off' } }).agent.diagnostics(PLACE, 'chat-1', '/work/db/a.sql')).rejects.toMatchObject({
            code: 'database-access-off'
        });
        await expect(rig({ context: { access: 'off' } }).agent.sqlFile(PLACE, '/work/db/a.sql')).rejects.toMatchObject({ code: 'database-access-off' });
        // A file no server of SQL reads says nothing of a schema.
        const typescript = rig({ context: { access: 'off' }, servers: [{ kind: 'typescript', state: 'ready' }] });
        expect((await typescript.agent.diagnostics(PLACE, 'chat-1', '/work/a.ts')).diagnostics).toHaveLength(1);
    });

    test('a server that is not installed, down or still starting is said plainly, and a file nothing serves too', async () => {
        await expect(rig({ servers: [{ kind: 'sql-native', state: 'not-installed' }] }).agent.diagnostics(PLACE, 'c', '/work/a.sql')).rejects.toMatchObject({
            code: 'language-server-not-installed'
        });
        await expect(
            rig({ servers: [{ kind: 'sql-native', state: 'crashed', message: 'exited' }] }).agent.diagnostics(PLACE, 'c', '/work/a.sql')
        ).rejects.toMatchObject({
            code: 'language-server-crashed'
        });
        await expect(rig({ servers: [{ kind: 'sql-native', state: 'starting' }] }).agent.diagnostics(PLACE, 'c', '/work/a.sql')).rejects.toMatchObject({
            code: 'language-server-starting'
        });
        await expect(rig({ servers: [] }).agent.diagnostics(PLACE, 'c', '/work/a.txt')).rejects.toMatchObject({ code: 'no-language-server' });
    });

    test('what a .sql file is read against, with the command that checks it from a shell', async () => {
        const snapshot = {
            path: '/home/.ruimte/database-snapshots/p1/shop/shop.json',
            connectionId: 'shop',
            database: 'shop',
            dialect: 'mariadb',
            version: '11.4.2-MariaDB',
            takenAt: '2026-10-07T09:00:00.000Z',
            tables: 4
        };
        const answer = await rig({
            context: { snapshot },
            program: '/home/.ruimte/language-servers/sql-native/versions/0.1.3/bin/sql-language-server'
        }).agent.sqlFile(PLACE, '/work/db/a.sql');
        expect(answer).toEqual({
            path: 'db/a.sql',
            source: 'default',
            connection: { id: 'shop', name: 'Shop', engine: 'mysql' },
            database: 'shop',
            dialect: 'mariadb',
            version: '11.4.2-MariaDB',
            snapshot: snapshot.path,
            takenAt: snapshot.takenAt,
            command: `/home/.ruimte/language-servers/sql-native/versions/0.1.3/bin/sql-language-server check --dialect mariadb --version 11.4.2-MariaDB --schema ${snapshot.path} /work/db/a.sql`,
            installed: true
        });
        const none = await rig({ context: { choice: { source: 'none' } } }).agent.sqlFile(PLACE, '/work/db/my file.sql');
        expect(none).toMatchObject({
            source: 'none',
            connection: null,
            snapshot: null,
            command: "sql-language-server check '/work/db/my file.sql'",
            installed: false
        });
        await expect(rig().agent.sqlFile(PLACE, '/work/a.php')).rejects.toMatchObject({ code: 'not-sql' });
    });
});

describe('the problems of the whole project', () => {
    const problem = (message: string, line = 0) => ({ range: range(line, 0, 3), severity: 2 as const, source: 'ts', code: 7, message });
    const report = (path: string, server: string, ...diagnostics: ReturnType<typeof problem>[]) => ({
        server,
        path,
        absolutePath: `/work/${path}`,
        diagnostics
    });

    test('lists them by path, line and column, with the kind of each process', async () => {
        const { agent } = rig({
            text: 'abc\ndef\n',
            workspace: {
                servers: ['typescript', 'vue'],
                pulled: true,
                files: 2,
                reports: [report('src/b.ts', 'typescript', problem('second', 1), problem('first')), report('src/a.vue', 'vue', problem('vue one'))]
            }
        });
        const answer = await agent.problems(PLACE, 'chat-1', null);

        expect(answer.servers).toEqual([
            { kind: 'typescript', process: 'typescript' },
            { kind: 'vue', process: 'vue' }
        ]);
        expect(answer.files).toBe(2);
        expect(answer.diagnostics.map((diagnostic) => `${diagnostic.path}:${diagnostic.line} ${diagnostic.message}`)).toEqual([
            'src/a.vue:1 vue one',
            'src/b.ts:1 first',
            'src/b.ts:2 second'
        ]);
        expect(answer).toMatchObject({ truncated: false, withheld: 0 });
    });

    test('keeps the first 500 and says it cut the rest', async () => {
        const many = Array.from({ length: 501 }, (_, index) => problem(`m${index}`, index));
        const { agent } = rig({
            text: 'x\n'.repeat(600),
            workspace: { servers: ['typescript'], pulled: true, files: 1, reports: [report('src/a.ts', 'typescript', ...many)] }
        });
        const answer = await agent.problems(PLACE, 'chat-1', null);

        expect(answer.diagnostics).toHaveLength(500);
        expect(answer.truncated).toBe(true);
    });

    test('leaves out a file whose SQL is read against a connection turned off for agents, and counts it', async () => {
        const { agent } = rig({
            context: { access: 'off' },
            workspace: {
                servers: ['sql-native', 'typescript'],
                pulled: true,
                files: 2,
                reports: [report('db/a.sql', 'sql-native', problem('sql one'), problem('sql two')), report('src/a.ts', 'typescript', problem('ts one'))]
            }
        });
        const answer = await agent.problems(PLACE, 'chat-1', null);

        expect(answer.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(['ts one']);
        expect(answer.withheld).toBe(1);
    });

    test('says no pull ran yet and still lists what it has', async () => {
        const { agent } = rig({
            text: 'abc\n',
            workspace: { servers: ['typescript'], pulled: false, files: 1, reports: [report('src/a.ts', 'typescript', problem('seen'))] }
        });
        const answer = await agent.problems(PLACE, 'chat-1', null);

        expect(answer.pulled).toBe(false);
        expect(answer.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(['seen']);
    });

    test('refuses when no running server reports for the whole project', async () => {
        await expect(rig().agent.problems(PLACE, 'chat-1', null)).rejects.toMatchObject({ code: 'no-workspace-diagnostics' });
    });

    test('opens the file it is given first, and is refused as that file would be', async () => {
        const workspace = { servers: ['typescript'], pulled: true, files: 1, reports: [report('src/a.ts', 'typescript', problem('one'))] };

        expect(
            (await rig({ servers: [{ kind: 'typescript', state: 'ready' }], workspace }).agent.problems(PLACE, 'chat-1', '/work/src/a.ts')).diagnostics
        ).toHaveLength(1);
        await expect(rig({ servers: [], workspace }).agent.problems(PLACE, 'chat-1', '/work/src/a.ts')).rejects.toMatchObject({ code: 'no-language-server' });
        await expect(rig({ context: { access: 'off' }, workspace }).agent.problems(PLACE, 'chat-1', '/work/db/a.sql')).rejects.toMatchObject({
            code: 'database-access-off'
        });
    });
});

describe('the type hierarchy', () => {
    const item = (name: string, line: number) => ({
        name,
        kind: 5,
        uri: 'file:///work/src/a.ts',
        range: range(line, 0, 9),
        selectionRange: range(line, 6, 10),
        data: { name }
    });

    test('prepares the type at the place and follows it up or down', async () => {
        const { agent, asked } = rig({
            text: 'class A {}\nclass B extends A {}\n',
            servers: [{ kind: 'typescript', state: 'ready' }],
            answers: {
                'textDocument/prepareTypeHierarchy': [item('B', 1)],
                'typeHierarchy/supertypes': [item('A', 0)],
                'typeHierarchy/subtypes': []
            }
        });
        const up = await agent.supertypes(PLACE, 'chat-1', '/work/src/a.ts', { line: 2, column: 7 });

        expect(up.type).toMatchObject({ name: 'B', kind: 'class', line: 2, column: 7 });
        expect(up.types).toEqual([{ path: 'src/a.ts', line: 1, column: 7, endLine: 1, endColumn: 11, name: 'A', kind: 'class', detail: null }]);
        expect(asked.map((call) => call.method)).toEqual(['textDocument/prepareTypeHierarchy', 'typeHierarchy/supertypes']);
        expect(asked[1]!.params).toMatchObject({ item: { name: 'B', data: { name: 'B' } } });

        const down = await agent.subtypes(PLACE, 'chat-1', '/work/src/a.ts', { line: 2, column: 7 });

        expect(down.types).toEqual([]);
        expect(asked.at(-1)?.method).toBe('typeHierarchy/subtypes');
    });

    test('answers no type where the servers find none', async () => {
        const { agent, asked } = rig({ servers: [{ kind: 'typescript', state: 'ready' }], answers: { 'textDocument/prepareTypeHierarchy': null } });
        const answer = await agent.supertypes(PLACE, 'chat-1', '/work/src/a.ts', { line: 1, column: 1 });

        expect(answer).toMatchObject({ type: null, types: [] });
        expect(asked).toHaveLength(1);
    });
});
