import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection, LanguageRequestResult } from '@ruimte/contracts';
import type { SqlFileContext } from '../database/sql-analysis.ts';
import { AgentLanguage, characterColumn, hoverText, locationsOf, symbolsOf, utf16Column } from './agent-language.ts';
import type { AgentDocument } from './host.ts';

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

function rig(options: { servers?: AgentDocument['servers']; answer?: unknown; context?: Partial<SqlFileContext>; text?: string; program?: string } = {}): Rig {
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
                        return { result: options.answer ?? null, server: 'sql-native', version: 1 } satisfies LanguageRequestResult;
                    },
                    diagnostics: async () => [
                        {
                            server: 'sql-native',
                            diagnostics: [{ range: range(0, 7, 12), severity: 1, source: 'sql', code: 'unresolved-column', message: "Unknown column 'emial'" }]
                        }
                    ]
                }) as never,
            programOf: () => options.program ?? null
        },
        sql: { fileContext: async () => context },
        readText: async () => text
    });
    return { agent, asked, context };
}

describe('the language verb of an agent', () => {
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
