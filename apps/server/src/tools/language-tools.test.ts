import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanvasHost, LanguageAgentHost, Noun, Verb } from './verb.ts';
import { printed } from './verb-test-helpers.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('language') as Noun;

let root = '';
let folder = '';
let asked: { action: string; path: string; position?: { line: number; column: number } }[] = [];
let pulled = true;
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
    pulled = true;
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
        problems: async (_place, _caller, path) => {
            asked.push({ action: 'problems', path: path ?? '' });
            return {
                servers: [{ kind: 'typescript', process: 'typescript' }],
                files: 3,
                diagnostics: [
                    {
                        path: 'src/a.ts',
                        line: 2,
                        column: 5,
                        endLine: 2,
                        endColumn: 9,
                        severity: 'warning',
                        server: 'typescript',
                        source: 'ts',
                        code: '6133',
                        message: 'unused'
                    }
                ],
                truncated: true,
                withheld: 2,
                pulled
            };
        },
        supertypes: async (_place, _caller, path, position) => {
            asked.push({ action: 'supertypes', path, position });
            return {
                path: 'src/a.ts',
                unsaved: false,
                servers: SERVERS,
                type: { path: 'src/a.ts', line: 2, column: 7, endLine: 2, endColumn: 8, name: 'B', kind: 'class', detail: null },
                types: [{ path: 'src/a.ts', line: 1, column: 7, endLine: 1, endColumn: 8, name: 'A', kind: 'class', detail: null }]
            };
        },
        subtypes: async (_place, _caller, path, position) => {
            asked.push({ action: 'subtypes', path, position });
            return {
                path: 'src/a.ts',
                unsaved: false,
                servers: SERVERS,
                type: { path: 'src/a.ts', line: 1, column: 7, endLine: 1, endColumn: 8, name: 'A', kind: 'class', detail: null },
                types: []
            };
        },
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
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder, canvasId: null } : null) },
        checkouts: { paths: async () => [] },
        language
    } as unknown as CanvasHost;
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function run(argv: string[]): Promise<string[]> {
    return printed(noun, argv, { caller: 'chat-1', host });
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

    test('prints the problems of the whole project, with a note for what was cut and what was withheld', async () => {
        expect(await run(['problems'])).toEqual([
            'server\ttypescript\ttypescript',
            'diagnostic\tsrc/a.ts:2:5\twarning\tts/6133\tunused',
            'note\tOnly the first 500 problems are listed; language diagnostics <path> reads one file whole',
            'note\tWithheld from 2 files read against a connection turned off for agents'
        ]);
        expect(asked.at(-1)).toEqual({ action: 'problems', path: '' });

        await run(['problems', 'db/report.sql']);

        expect(asked.at(-1)).toEqual({ action: 'problems', path: join(folder, 'db', 'report.sql') });
        expect(JSON.parse((await run(['problems', '--json']))[0]!)).toMatchObject({ files: 3, truncated: true, withheld: 2 });
    });

    test('notes that no whole-project check ran yet, and still prints what it has', async () => {
        pulled = false;

        expect(await run(['problems'])).toContain('note\tNo whole-project check ran yet; a person starts one from the Problems panel');
        expect(await run(['problems'])).toContain('diagnostic\tsrc/a.ts:2:5\twarning\tts/6133\tunused');
    });

    test('prints the type at a place and one location per supertype or subtype', async () => {
        expect(await run(['supertypes', 'db/report.sql', '2', '7'])).toEqual([
            'server\tsql-native\tready',
            'type\tB\tclass\t-',
            'location\tsrc/a.ts:1:7\t1:8\tA'
        ]);
        expect(asked.at(-1)).toMatchObject({ action: 'supertypes', position: { line: 2, column: 7 } });
        expect((await run(['subtypes', 'db/report.sql', '1', '7'])).at(-1)).toStartWith('note\t');
        expect((await run(['supertypes', 'db/report.sql', '1']))[0]).toStartWith('refused\t');
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
