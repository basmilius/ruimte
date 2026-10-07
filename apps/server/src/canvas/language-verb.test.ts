import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refusalBody } from '@adecore/agents/context/refusal';
import type { LanguageAgentHost } from './verb.ts';
import { VerbRefusal, type CanvasHost, type Noun, type Verb } from './verb.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('language') as Noun;

let root = '';
let folder = '';
let asked: { action: string; path: string; position?: { line: number; column: number } }[] = [];
let host: CanvasHost;

const SERVERS = [{ kind: 'sql-native', state: 'ready' }];

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-language-verb-')));
    folder = join(root, 'repo');
    await mkdir(join(folder, 'db'), { recursive: true });
    await writeFile(join(folder, 'db', 'report.sql'), 'SELECT emial FROM users;\n');
    await writeFile(join(root, 'outside.sql'), 'SELECT 1;\n');
    await symlink(join(root, 'outside.sql'), join(folder, 'db', 'linked.sql'));
    asked = [];
    const language: LanguageAgentHost = {
        diagnostics: async (_place, _caller, path) => {
            asked.push({ action: 'diagnostics', path });
            return {
                path: 'db/report.sql',
                unsaved: true,
                servers: SERVERS,
                diagnostics: [
                    {
                        path: 'db/report.sql',
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
            };
        },
        hover: async (_place, _caller, path, position) => {
            asked.push({ action: 'hover', path, position });
            return { path: 'db/report.sql', unsaved: false, servers: SERVERS, contents: '**users**\n\n- id bigint' };
        },
        definition: async (_place, _caller, path, position) => {
            asked.push({ action: 'definition', path, position });
            return { path: 'db/report.sql', unsaved: false, servers: SERVERS, locations: [] };
        },
        references: async (_place, _caller, path, position) => {
            asked.push({ action: 'references', path, position });
            return {
                path: 'db/report.sql',
                unsaved: false,
                servers: SERVERS,
                locations: [{ path: 'db/report.sql', line: 1, column: 19, endLine: 1, endColumn: 24 }]
            };
        },
        symbols: async () => ({
            path: 'db/report.sql',
            unsaved: false,
            servers: SERVERS,
            symbols: [{ name: 'users', kind: 'class', detail: null, depth: 0, line: 1, column: 19, endLine: 1, endColumn: 24 }]
        }),
        sqlFile: async () => ({
            path: 'db/report.sql',
            source: 'file',
            connection: { id: 'shop', name: 'Shop', engine: 'mysql' },
            database: 'shop',
            dialect: 'mariadb',
            version: '11.4.2-MariaDB',
            snapshot: '/home/snap/shop.json',
            takenAt: '2026-10-07T09:00:00.000Z',
            command: 'sql-language-server check --dialect mariadb --version 11.4.2-MariaDB --schema /home/snap/shop.json /repo/db/report.sql',
            installed: false
        })
    };
    host = {
        locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder, canvasId: null } : null),
        worktreePaths: async () => [],
        language
    } as unknown as CanvasHost;
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function run(argv: string[]): Promise<string[]> {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

describe('ruimte-context language', () => {
    test('prints the problems of a file a line each, with the servers and a note on unsaved text', async () => {
        expect(await run(['diagnostics', 'db/report.sql'])).toEqual([
            'server\tsql-native\tready',
            "note\tThe file is open in an editor with changes that are not saved; these answers are about the editor's text, not the file on disk",
            "diagnostic\tdb/report.sql:1:8\terror\tsql/unresolved-column\tUnknown column 'emial'"
        ]);
        expect(asked).toEqual([{ action: 'diagnostics', path: join(folder, 'db', 'report.sql') }]);
    });

    test('prints JSON on --json', async () => {
        const [text] = await run(['diagnostics', 'db/report.sql', '--json']);
        expect(JSON.parse(text!)).toMatchObject({ path: 'db/report.sql', diagnostics: [{ code: 'unresolved-column' }] });
    });

    test('takes a place as a line and a column from 1', async () => {
        expect(await run(['hover', 'db/report.sql', '1', '19'])).toEqual([
            'server\tsql-native\tready',
            'hover\tdb/report.sql:1:19',
            '**users**\n\n- id bigint'
        ]);
        expect(asked.at(-1)).toMatchObject({ action: 'hover', position: { line: 1, column: 19 } });
        expect(await run(['references', 'db/report.sql', '1', '19'])).toEqual(['server\tsql-native\tready', 'location\tdb/report.sql:1:19\t1:24']);
        expect((await run(['definition', 'db/report.sql', '1', '19'])).at(-1)).toStartWith('note\t');
        expect((await run(['hover', 'db/report.sql', '0', '1']))[0]).toStartWith('refused\t');
        expect((await run(['hover', 'db/report.sql', '1']))[0]).toStartWith('refused\t');
    });

    test('lists the symbols with how deep each sits', async () => {
        expect(await run(['symbols', 'db/report.sql'])).toEqual(['server\tsql-native\tready', 'symbol\t0\tclass\tusers\t1:19\t-']);
    });

    test('says which connection and snapshot a SQL file reads, and how to check it from a shell', async () => {
        expect(await run(['sql', 'db/report.sql'])).toEqual([
            'source\tfile',
            'connection\tshop\tShop\tmysql',
            'database\tshop',
            'dialect\tmariadb\t11.4.2-MariaDB',
            'snapshot\t/home/snap/shop.json\t2026-10-07T09:00:00.000Z',
            'check\tsql-language-server check --dialect mariadb --version 11.4.2-MariaDB --schema /home/snap/shop.json /repo/db/report.sql',
            'note\tThe SQL server is not installed on this machine, so the command is not there yet; a person installs it in the app'
        ]);
    });

    test('a path outside the project folder or its worktrees is refused, a link out of it too', async () => {
        expect((await run(['diagnostics', join(root, 'outside.sql')]))[0]).toStartWith('refused\tpath-outside-project\t');
        expect((await run(['diagnostics', 'db/linked.sql']))[0]).toStartWith('refused\tpath-outside-project\t');
        expect((await run(['diagnostics', 'db/missing.sql']))[0]).toStartWith('refused\tbad-path\t');
        expect((await run(['diagnostics', 'db']))[0]).toStartWith('refused\tbad-path\t');
        expect(asked).toEqual([]);
    });

    test('help says what each action prints and how a SQL file is read', async () => {
        const help = (await (verbNamed('help') as Verb).run(['language'], { caller: 'chat-1', host })).join('\n');
        expect(help).toContain('language sql');
        expect(help).toContain('database-access-off');
        expect(help).toContain('sql-language-server check');
    });
});
