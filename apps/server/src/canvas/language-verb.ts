import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE, field, orNote } from './verb.ts';

const PATH_PARAM = { syntax: '<path>', need: 'required', field: 'path' } as const;

const JSON_PARAM = { syntax: '--json', need: 'no value', text: 'Prints the answer as one JSON object instead of lines' } as const;

const POSITION_PARAMS = [PATH_PARAM, { syntax: '<line>', need: 'required', field: 'line' }, { syntax: '<column>', need: 'required', field: 'column' }] as const;

const SERVER_REFUSALS =
    'bad-path\tpath-outside-project\tno-language-server\tlanguage-server-not-installed\tlanguage-server-crashed\tlanguage-server-starting\tdatabase-access-off';

const PLACE_LINE = 'place\tLines and columns count from 1, a column in characters; a path prints relative to the project folder, or absolute outside it';

const UNSAVED_NOTE = "note\tThe file is open in an editor with changes that are not saved; these answers are about the editor's text, not the file on disk";

type Head = { path: string; unsaved: boolean; servers: { kind: string; state: string; message?: string }[] };

function headLines(head: Head): string[] {
    return [
        ...head.servers.map((server) => `server\t${server.kind}\t${server.state}${server.message ? `\t${field(server.message)}` : ''}`),
        ...(head.unsaved ? [UNSAVED_NOTE] : [])
    ];
}

function place(span: { path: string; line: number; column: number }): string {
    return `${field(span.path)}:${span.line}:${span.column}`;
}

function json(value: unknown): string[] {
    return [JSON.stringify(value, null, 2)];
}

function pathTuple(word: string) {
    return z.tuple([z.string().trim().min(1, `language ${word} needs the path of a file`)], {
        error: (issue) => (issue.code === 'too_big' ? `language ${word} takes one path and nothing else` : `language ${word} needs the path of a file`)
    });
}

function positionTuple(word: string) {
    const needs = `language ${word} needs a path, a line and a column`;
    const number = (what: string) =>
        z.coerce
            .number({ error: `The ${what} is a whole number from 1` })
            .int(`The ${what} is a whole number from 1`)
            .min(1, `The ${what} is a whole number from 1`);
    return z.tuple([z.string().trim().min(1, needs), number('line'), number('column')], {
        error: (issue) => (issue.code === 'too_big' ? `language ${word} takes a path, a line and a column and nothing else` : needs)
    });
}

const diagnosticsAction = defineActionVerb('language', {
    name: 'diagnostics',
    action: 'language.diagnostics',
    usage: '<path> [--json]',
    params: [PATH_PARAM, JSON_PARAM],
    detail: [
        'prints\tserver\tkind\tstate\tone line per language server of the file, and why one is down',
        'prints\tdiagnostic\tpath:line:column\tseverity\tsource/code\tmessage\tone line per problem, in the order of the file; severity is error, warning, information or hint, and source/code a dash where the server gives none',
        'sql\tThe SQL in a .sql file, and in the strings of a PHP file, comes with the source sql and the id of the inspection as its code',
        PLACE_LINE,
        `refusals\t${SERVER_REFUSALS}\tthe codes this action refuses with`
    ],
    positionals: pathTuple('diagnostics'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path], switches }, call) {
        const answer = await runAction(call, 'language.diagnostics', { path });
        if (switches.has('json')) {
            return json(answer);
        }
        return [
            ...headLines(answer),
            ...orNote(
                answer.diagnostics.map((diagnostic) =>
                    [
                        'diagnostic',
                        place(diagnostic),
                        diagnostic.severity,
                        diagnostic.source === null && diagnostic.code === null ? '-' : field([diagnostic.source ?? '-', diagnostic.code ?? '-'].join('/')),
                        field(diagnostic.message)
                    ].join('\t')
                ),
                'The language servers find no problem in this file'
            )
        ];
    }
});

const hoverAction = defineActionVerb('language', {
    name: 'hover',
    action: 'language.hover',
    usage: '<path> <line> <column> [--json]',
    params: [...POSITION_PARAMS, JSON_PARAM],
    detail: [
        'prints\thover\tpath:line:column\tthe first line, then what the servers say of the name there, as markdown, on the lines after it',
        'sql\tOn a table or a column in SQL that is read against a schema snapshot: its columns, type and comment as the database has them',
        PLACE_LINE,
        `refusals\t${SERVER_REFUSALS}\tbad-position\tthe codes this action refuses with`
    ],
    positionals: positionTuple('hover'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path, line, column], switches }, call) {
        const answer = await runAction(call, 'language.hover', { path, line, column });
        if (switches.has('json')) {
            return json(answer);
        }
        return [
            ...headLines(answer),
            ...(answer.contents === null
                ? ['note\tThe language servers have nothing to say about that place']
                : [`hover\t${place({ path: answer.path, line, column })}`, answer.contents])
        ];
    }
});

function locationsLines(answer: ActionOutput<'language.definition'>, none: string): string[] {
    return [
        ...headLines(answer),
        ...orNote(
            answer.locations.map((location) => `location\t${place(location)}\t${location.endLine}:${location.endColumn}`),
            none
        )
    ];
}

const definitionAction = defineActionVerb('language', {
    name: 'definition',
    action: 'language.definition',
    usage: '<path> <line> <column> [--json]',
    params: [...POSITION_PARAMS, JSON_PARAM],
    detail: [
        'prints\tlocation\tpath:line:column\tendLine:endColumn\tone line per place the name is defined',
        'sql\tA table or column only a schema snapshot knows has no place in a file, so it prints none; language hover says what it is',
        PLACE_LINE,
        `refusals\t${SERVER_REFUSALS}\tbad-position\tthe codes this action refuses with`
    ],
    positionals: positionTuple('definition'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path, line, column], switches }, call) {
        const answer = await runAction(call, 'language.definition', { path, line, column });
        return switches.has('json') ? json(answer) : locationsLines(answer, 'The language servers know no definition of the name at that place');
    }
});

const referencesAction = defineActionVerb('language', {
    name: 'references',
    action: 'language.references',
    usage: '<path> <line> <column> [--json]',
    params: [...POSITION_PARAMS, JSON_PARAM],
    detail: [
        'prints\tlocation\tpath:line:column\tendLine:endColumn\tone line per place the name is used, its definition included',
        PLACE_LINE,
        `refusals\t${SERVER_REFUSALS}\tbad-position\tthe codes this action refuses with`
    ],
    positionals: positionTuple('references'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path, line, column], switches }, call) {
        const answer = await runAction(call, 'language.references', { path, line, column });
        return switches.has('json') ? json(answer) : locationsLines(answer, 'The language servers know no use of the name at that place');
    }
});

const symbolsAction = defineActionVerb('language', {
    name: 'symbols',
    action: 'language.symbols',
    usage: '<path> [--json]',
    params: [PATH_PARAM, JSON_PARAM],
    detail: [
        'prints\tsymbol\tdepth\tkind\tname\tline:column\tdetail\tone line per symbol in reading order; depth is 0 at the top and one more inside each symbol, detail a dash where there is none',
        PLACE_LINE,
        `refusals\t${SERVER_REFUSALS}\tthe codes this action refuses with`
    ],
    positionals: pathTuple('symbols'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path], switches }, call) {
        const answer = await runAction(call, 'language.symbols', { path });
        if (switches.has('json')) {
            return json(answer);
        }
        return [
            ...headLines(answer),
            ...orNote(
                answer.symbols.map((symbol) =>
                    [
                        'symbol',
                        String(symbol.depth),
                        symbol.kind,
                        field(symbol.name),
                        `${symbol.line}:${symbol.column}`,
                        symbol.detail === null ? '-' : field(symbol.detail)
                    ].join('\t')
                ),
                'The language servers find no symbol in this file'
            )
        ];
    }
});

const sqlAction = defineActionVerb('language', {
    name: 'sql',
    action: 'language.sql',
    usage: '<path> [--json]',
    params: [PATH_PARAM, JSON_PARAM],
    detail: [
        "prints\tsource\tfile, console, default, none or unbound: the file's own choice, the console folder it is in, the project's default, nothing chosen, or a person's choice of no connection",
        'prints\tconnection\tid\tname\tengine\tthe connection it is read against, absent when there is none',
        'prints\tdatabase\tname\tthe database, a dash for every database of a connection that starts in none',
        'prints\tdialect\tversion\tthe dialect and the version of the server the snapshot was taken of',
        'prints\tsnapshot\tpath\ttaken\tthe schema snapshot the file is read against and when it was taken; absent until a person opened the connection in the app on this machine',
        'prints\tcheck\tcommand\tthe command that checks the file from a shell: the SQL server this machine installed, with that dialect and snapshot',
        'shell\tsql-language-server check, format and describe run the same analysis from a shell; with --schema <snapshot> they know the tables and columns of the database, without opening it',
        'access\tA file read against a connection a person turned off for agents is refused with database-access-off, here and in every other language action',
        PLACE_LINE,
        'refusals\tbad-path\tpath-outside-project\tnot-sql\tdatabase-access-off\tthe codes this action refuses with'
    ],
    positionals: pathTuple('sql'),
    flags: z.object({}),
    switches: ['json'],
    async run({ positionals: [path], switches }, call) {
        const answer = await runAction(call, 'language.sql', { path });
        if (switches.has('json')) {
            return json(answer);
        }
        return [
            `source\t${answer.source}`,
            ...(answer.connection === null
                ? []
                : [`connection\t${field(answer.connection.id)}\t${field(answer.connection.name)}\t${answer.connection.engine}`]),
            ...(answer.connection === null ? [] : [`database\t${answer.database === null ? '-' : field(answer.database)}`]),
            ...(answer.dialect === null ? [] : [`dialect\t${answer.dialect}\t${answer.version ?? '-'}`]),
            ...(answer.snapshot === null
                ? answer.connection === null
                    ? []
                    : [
                          'note\tNo schema snapshot of this connection was taken on this machine yet; a person opens the connection in the Databases panel of the app'
                      ]
                : [`snapshot\t${field(answer.snapshot)}\t${answer.takenAt ?? '-'}`]),
            `check\t${answer.command}`,
            ...(answer.installed
                ? []
                : ['note\tThe SQL server is not installed on this machine, so the command is not there yet; a person installs it in the app'])
        ];
    }
});

export const LANGUAGE_SUMMARY =
    "Asks the project's running language servers about a file: its problems, what a name is, where it is defined and used, its symbols, and what a .sql file is read against";

export const LANGUAGE_DETAIL: readonly string[] = [
    'when\tBefore and after you change a file, to see what the language servers see: language diagnostics for its problems, hover, definition and references for a name, symbols for what it defines',
    'servers\tA file opens in the servers of this machine that are installed, as it would for a person; one that is not installed stays so, since only a person installs one in the app',
    "sql\tA .sql file is read against a connection and database a person chose for it, the folder of a console, or the project's default, which the SQL in the strings of PHP files is read against too; language sql says which, with the schema snapshot and the shell command",
    'shell\tWith only a shell, language sql <path> prints the snapshot a .sql file is read against and the command that checks it, such as sql-language-server check --dialect mariadb --schema <snapshot> <path>; describe and format run the same way',
    'access\tA file whose SQL is read against a connection a person turned off for agents is refused with database-access-off, the rule database holds you to',
    SCOPE_LINE
];

export const LANGUAGE_ACTIONS = [diagnosticsAction, hoverAction, definitionAction, referencesAction, symbolsAction, sqlAction] as const;
