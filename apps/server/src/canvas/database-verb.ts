import { DATABASE_QUERY_MAX_ROWS, DATABASE_QUERY_ROWS } from '@ruimte/actions';
import { VISUAL_LIMITS } from '@ruimte/contracts';
import type { Cell, StatementResult } from '@adecore/database/protocol';
import { z } from 'zod';
import { visualRow } from '../actions/visual-actions.ts';
import { AGENT_CELL_LIMIT, AGENT_DATABASE_LIMIT_MS, EXECUTE_ROW_LIMIT } from '../database/agent-databases.ts';
import { binarySize } from '../database/table-visual.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SHOWN_LINE } from './visual-verb.ts';
import { SCOPE_LINE, VerbRefusal, field, orNote } from './verb.ts';

const CONNECTION_PARAM = { syntax: '<connection>', need: 'required', field: 'connection', more: 'ruimte-context database list names them' } as const;

const SCHEMA_PARAM = { syntax: '--schema S', need: 'optional', field: 'schema' } as const;

const ESCAPES: Readonly<Record<string, string>> = { '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' };

/* A text cell on one tab-separated line, readable back byte for byte. */
function escapedText(text: string): string {
    return text.replace(/[\\\t\n\r]/g, (char) => ESCAPES[char]!);
}

export function cellText(cell: Cell): string {
    if (cell === null) {
        return 'NULL';
    }
    if (typeof cell === 'string') {
        return escapedText(cell);
    }
    if (typeof cell !== 'object') {
        return String(cell);
    }
    if (cell.kind === 'binary') {
        return `[${binarySize(cell)} bytes of binary]`;
    }
    return `${escapedText(cell.preview)}… [${cell.length} characters]`;
}

function elapsed(ms: number): string {
    return `elapsed\t${Math.round(ms * 10) / 10} ms`;
}

function rowsLines(result: { columns: readonly { name: string }[]; rows: readonly (readonly unknown[])[]; hasMore: boolean }, more: string): string[] {
    return [
        `columns\t${result.columns.map((column) => field(column.name)).join('\t')}`,
        ...result.rows.map((row) => `row\t${row.map((cell) => cellText(cell as Cell)).join('\t')}`),
        `rows\t${result.rows.length}`,
        ...(result.hasMore ? [`more\t${more}`] : [])
    ];
}

const sqlFlag = (verb: string, needs: string) =>
    z
        .string({ error: `database ${verb} needs ${needs}, on stdin or as --sql` })
        .trim()
        .min(1, `database ${verb} needs ${needs}, on stdin or as --sql`);

function connectionTuple(verb: string) {
    return z.tuple([z.string().min(1, `database ${verb} needs the id or the name of a connection`)], {
        error: (issue) =>
            issue.code === 'too_big' ? `database ${verb} takes one connection and nothing else` : `database ${verb} needs the id or the name of a connection`
    });
}

const SQL_PARAM_MORE = 'given as one argument instead of on stdin; the CLI puts stdin here when you give no --sql';

const CELLS_LINE = `cells\tNULL is SQL NULL; a backslash, tab, newline or carriage return in a text is written \\\\, \\t, \\n or \\r; a text past ${AGENT_CELL_LIMIT} characters prints its start, … and its length; a binary value prints its size`;

const SESSION_LINE = `session\tEvery call opens a session of its own and closes it before it answers, so nothing carries over to the next call: no transaction, temporary table or USE. A call that runs longer than ${AGENT_DATABASE_LIMIT_MS / 1000} s is stopped (database-timeout)`;

const ACCESS_REFUSALS = 'database-no-project\tunknown-connection\tambiguous-connection\tdatabase-access-off\tdatabase-outside-project\tdatabase-locked';

const SERVER_REFUSALS = 'query-failed\tunsupported\tread-only\tauth-failed\tconnect-failed\ttunnel-failed\thelper-unavailable\tdatabase-timeout';

const listAction = defineActionVerb('database', {
    name: 'list',
    action: 'database.list',
    usage: '',
    params: [],
    detail: [
        'prints\tid\tname\tengine\twhere\taccess\tone line per connection of the project, in the order of its Databases panel; where is the file, or the account, server and database, never a password',
        'access\toff, read or write, as a person set it for agents in the connections dialog of the app, read when they set nothing; outside-project for a SQLite file outside the project folder, which only a person opens',
        `refusals\tdatabase-no-project\tthe Chats project has no databases`
    ],
    positionals: z.tuple([], { error: 'database list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { connections } = await runAction(call, 'database.list', {});
        return orNote(
            connections.map((connection) =>
                [
                    field(connection.id),
                    field(connection.name),
                    connection.engine,
                    field(connection.target),
                    connection.outsideProject ? 'outside-project' : connection.access
                ].join('\t')
            ),
            'This project has no database connections; a person adds them in the Databases panel of the app'
        );
    }
});

const tablesAction = defineActionVerb('database', {
    name: 'tables',
    action: 'database.tables',
    usage: '<connection> [--schema S]',
    params: [CONNECTION_PARAM, SCHEMA_PARAM],
    detail: [
        'prints\tschema\tname\tone line per schema of the server, the ones it keeps for itself left out',
        'prints\ttable\tschema\tname\tkind\trows\tone line per table or view of the listed schemas; rows is what the server estimates, which can be far off, or a dash',
        `refusals\t${ACCESS_REFUSALS}\t${SERVER_REFUSALS}\tthe codes this action refuses with; the message of each says what to do instead`
    ],
    positionals: connectionTuple('tables'),
    flags: z.object({ schema: z.string().min(1, '--schema needs the name of a schema').optional() }),
    async run({ positionals: [connection], flags }, call) {
        const listed = await runAction(call, 'database.tables', { connection, schema: flags.schema ?? null });
        return [
            ...listed.schemas.map((schema) => `schema\t${field(schema)}`),
            ...orNote(
                listed.tables.map(
                    (table) => `table\t${field(table.schema)}\t${field(table.name)}\t${table.kind}\t${table.rowEstimate === null ? '-' : table.rowEstimate}`
                ),
                'No table or view in the listed schemas; name another with --schema'
            )
        ];
    }
});

const describeAction = defineActionVerb('database', {
    name: 'describe',
    action: 'database.describe',
    usage: '<connection> <table> [--schema S]',
    params: [CONNECTION_PARAM, { syntax: '<table>', need: 'required', field: 'table', more: 'database tables lists them' }, SCHEMA_PARAM],
    detail: [
        'prints\ttable\tschema\tname\tkind\tthe first line',
        'prints\tcolumn\tname\ttype\tnull|not-null\tdefault\tflags\tone line per column in order; default and flags (primary-key, auto-increment, generated) are a dash when there are none',
        'prints\tprimary\tcolumns\tthe primary key, comma separated, or a dash',
        'prints\tindex\tname\tunique|index\tcolumns\tone line per index other than the primary key',
        'prints\tforeign\tname\tcolumns\treferences\ton-update\ton-delete\tone line per foreign key; references is schema.table(columns)',
        `refusals\t${ACCESS_REFUSALS}\tschema-required\t${SERVER_REFUSALS}\tthe codes this action refuses with; schema-required lists the schemas to name with --schema`
    ],
    positionals: z.tuple(
        [z.string().min(1, 'database describe needs a connection and a table'), z.string().min(1, 'database describe needs a connection and a table')],
        {
            error: (issue) =>
                issue.code === 'too_big'
                    ? 'database describe takes a connection and a table and nothing else'
                    : 'database describe needs a connection and a table'
        }
    ),
    flags: z.object({ schema: z.string().min(1, '--schema needs the name of a schema').optional() }),
    async run({ positionals: [connection, table], flags }, call) {
        const structure = await runAction(call, 'database.describe', { connection, table, schema: flags.schema ?? null });
        const primary = new Set(structure.primaryKey);
        return [
            `table\t${field(structure.schema)}\t${field(structure.name)}\t${structure.kind}`,
            ...structure.columns.map((column) => {
                const flagsOf = [
                    ...(primary.has(column.name) ? ['primary-key'] : []),
                    ...(column.autoIncrement ? ['auto-increment'] : []),
                    ...(column.generated ? ['generated'] : [])
                ];
                return [
                    'column',
                    field(column.name),
                    column.type === '' ? '-' : field(column.type),
                    column.nullable ? 'null' : 'not-null',
                    column.defaultValue === null ? '-' : field(column.defaultValue),
                    flagsOf.length === 0 ? '-' : flagsOf.join(',')
                ].join('\t');
            }),
            `primary\t${structure.primaryKey.length === 0 ? '-' : structure.primaryKey.map(field).join(',')}`,
            ...structure.indexes
                .filter((index) => !index.primary)
                .map((index) => `index\t${field(index.name)}\t${index.unique ? 'unique' : 'index'}\t${index.columns.map(field).join(',')}`),
            ...structure.foreignKeys.map((key) =>
                [
                    'foreign',
                    key.name === null ? '-' : field(key.name),
                    key.columns.map(field).join(','),
                    `${field(key.referencedSchema)}.${field(key.referencedTable)}(${key.referencedColumns.map(field).join(',')})`,
                    key.onUpdate ?? '-',
                    key.onDelete ?? '-'
                ].join('\t')
            )
        ];
    }
});

const queryAction = defineActionVerb('database', {
    name: 'query',
    action: 'database.query',
    usage: '<connection> [--schema S] [--limit N] [--show TITLE] (< query.sql | --sql Q)',
    params: [
        CONNECTION_PARAM,
        SCHEMA_PARAM,
        { syntax: '--limit N', need: 'optional', field: 'limit', more: `a whole number from 1 to ${DATABASE_QUERY_MAX_ROWS}` },
        {
            syntax: '--show TITLE',
            need: 'optional',
            field: 'show',
            more: `at most ${VISUAL_LIMITS.title} characters; only in an AI chat, and only while visual replies are on`
        },
        { syntax: '--sql Q', need: 'optional', field: 'sql', more: SQL_PARAM_MORE }
    ],
    detail: [
        "stdin\tThe statement, piped in or as a heredoc: ruimte-context database query shop <<'EOF' ... EOF",
        'read\tOne statement that starts with SELECT or WITH, on a session opened read only; anything else, several statements included, is refused with unsupported',
        'order\tThe statement is read as a subquery, and MariaDB and MySQL drop an ORDER BY there unless a LIMIT follows it. A statement with no LIMIT anywhere gets one of --limit plus one; one that has a LIMIT in it keeps its ORDER BY only with a LIMIT right after it',
        'prints\tcolumns\tname\t...\tthe names of the columns of the result',
        'prints\trow\tvalue\t...\tone line per row, in the order of the result',
        CELLS_LINE,
        `prints\trows\tcount\tthe rows printed, then more when the result holds more than --limit (${DATABASE_QUERY_ROWS} without it)`,
        'prints\telapsed\tms\tthe time the database took',
        `show\tWith --show the person also sees the rows as a table above your reply, titled TITLE; then a visual line and the shown line of visual show follow, or a note when the table could not be shown. The table holds the same rows, so your reply does not repeat them`,
        `refusals\t${ACCESS_REFUSALS}\t${SERVER_REFUSALS}\tthe codes this action refuses with; on query-failed the message is the server's, so fix the SQL and ask again`
    ],
    positionals: connectionTuple('query'),
    flags: z.object({
        schema: z.string().min(1, '--schema needs the name of a schema').optional(),
        limit: z.coerce
            .number({ error: `--limit takes a whole number from 1 to ${DATABASE_QUERY_MAX_ROWS}` })
            .int(`--limit takes a whole number from 1 to ${DATABASE_QUERY_MAX_ROWS}`)
            .min(1, `--limit takes a whole number from 1 to ${DATABASE_QUERY_MAX_ROWS}`)
            .max(DATABASE_QUERY_MAX_ROWS, `--limit is at most ${DATABASE_QUERY_MAX_ROWS}; narrow the query instead`)
            .optional(),
        show: z
            .string()
            .trim()
            .min(1, '--show needs a title, a few words that say what the table shows')
            .max(VISUAL_LIMITS.title, `--show takes a title of at most ${VISUAL_LIMITS.title} characters`)
            .optional(),
        sql: sqlFlag('query', 'one SELECT or WITH statement')
    }),
    async run({ positionals: [connection], flags }, call) {
        const query = await runAction(call, 'database.query', {
            connection,
            sql: flags.sql,
            schema: flags.schema ?? null,
            limit: flags.limit ?? null,
            show: flags.show ?? null
        });
        const limit = flags.limit ?? DATABASE_QUERY_ROWS;
        const more =
            limit < DATABASE_QUERY_MAX_ROWS
                ? `The result holds more rows than these ${query.rows.length}; raise --limit, at most ${DATABASE_QUERY_MAX_ROWS}, or narrow the query`
                : `The result holds more rows than these ${query.rows.length}; narrow the query or count them with COUNT(*)`;
        const shown =
            query.shown === null
                ? []
                : 'visual' in query.shown
                  ? [visualRow(query.shown.visual), SHOWN_LINE]
                  : [`note\tThe table was not shown: ${field(query.shown.reason)}`];
        return [...rowsLines(query, more), elapsed(query.elapsedMs), ...shown];
    }
});

function statementLines(result: StatementResult, index: number): string[] {
    const head = `statement\t${index + 1}\t${field(result.sql.trim()).slice(0, 200)}`;
    if (result.kind === 'rows') {
        return [
            head,
            ...rowsLines(result, `This statement read more rows than these ${result.rows.length}; database query reads more of one`),
            elapsed(result.elapsedMs)
        ];
    }
    if (result.kind === 'done') {
        const id = result.lastInsertId === null ? '' : `\tlast-insert-id\t${result.lastInsertId}`;
        return [head, `done\t${result.affected}${id}`, elapsed(result.elapsedMs)];
    }
    return [head];
}

const executeAction = defineActionVerb('database', {
    name: 'execute',
    action: 'database.execute',
    usage: '<connection> [--schema S] (< statements.sql | --sql Q)',
    params: [CONNECTION_PARAM, SCHEMA_PARAM, { syntax: '--sql Q', need: 'optional', field: 'sql', more: SQL_PARAM_MORE }],
    detail: [
        "stdin\tThe statements, piped in or as a heredoc: ruimte-context database execute shop <<'EOF' ... EOF",
        'write\tOnly on a connection a person on this machine set to read and write for agents in the connections dialog of the app (database-write-off otherwise), and never while you run in supervised (database-write-mode); ask the person instead',
        'prints\tstatement\tn\tsql\tone line per statement in order, the start of its SQL, followed by what it did',
        'prints\tdone\taffected\tlast-insert-id\tid\tfor a statement that changed rows; the id only when the server gave one',
        `prints\tcolumns|row|rows|more\tfor a statement that read, as database query prints them, at most ${EXECUTE_ROW_LIMIT} rows`,
        CELLS_LINE,
        'prints\telapsed\tms\tafter each statement',
        "failure\tA statement that fails ends the call, refused with its code and the server's message; the lines before it say what already ran, which stays done unless a transaction you began was still open",
        'transaction\tA transaction still open when the call ends is rolled back: begin and commit it in one call',
        `refusals\t${ACCESS_REFUSALS}\tdatabase-write-off\tdatabase-write-mode\t${SERVER_REFUSALS}\tthe codes this action refuses with`
    ],
    positionals: connectionTuple('execute'),
    flags: z.object({
        schema: z.string().min(1, '--schema needs the name of a schema').optional(),
        sql: sqlFlag('execute', 'the statements to run')
    }),
    async run({ positionals: [connection], flags }, call) {
        const executed = await runAction(call, 'database.execute', { connection, sql: flags.sql, schema: flags.schema ?? null });
        const results = executed.results as unknown as StatementResult[];
        const lines: string[] = [];
        for (const [index, result] of results.entries()) {
            if (result.kind === 'error') {
                const state = result.error.sqlState === undefined ? '' : ` (SQLSTATE ${result.error.sqlState})`;
                throw new VerbRefusal(result.error.code, `Statement ${index + 1} failed: ${result.error.message}${state}`, [
                    ...lines,
                    ...statementLines(result, index),
                    'note\tThe statements before it ran; the ones after it did not'
                ]);
            }
            lines.push(...statementLines(result, index));
        }
        if (executed.inTransaction) {
            lines.push('note\tA transaction was still open when the call ended and was rolled back; begin and commit it in one call');
        }
        return orNote(lines, 'There was no statement to run');
    }
});

export const DATABASE_SUMMARY =
    "Reads the project's databases: the connections, their tables and columns and the rows of a query, as a table above your reply when asked; writes only where a person allowed it";

export const DATABASE_DETAIL: readonly string[] = [
    "when\tA question about the project's data, such as the last orders over an amount or how many users signed up this week: database list for the connections, database tables and database describe for where the data is, then database query",
    'read\tA query is one statement that starts with SELECT or WITH, on a session opened read only; it never changes anything',
    'show\tquery --show TITLE puts the rows as a table above your reply in an AI chat; the reply then adds what the table does not say and does not repeat the rows',
    'write\tdatabase execute writes, only on a connection a person on this machine allowed agents to write to in the connections dialog of the app; you cannot allow it yourself',
    'access\tA person can also turn a connection off for agents, and every action on it is refused with database-access-off',
    SESSION_LINE,
    SCOPE_LINE
];

export const DATABASE_ACTIONS = [listAction, tablesAction, describeAction, queryAction, executeAction] as const;
