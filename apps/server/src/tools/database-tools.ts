import { ToolRefusal } from '@adecore/agents/context';
import type { Cell, StatementResult } from '@adecore/database/protocol';
import { DATABASE_QUERY_MAX_ROWS, DATABASE_QUERY_ROWS } from '@ruimte/actions';
import { VISUAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { visualRow } from '../actions/visual-actions.ts';
import { field, orNote } from '../canvas/host.ts';
import { binarySize } from '../database/table-visual.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit } from './tool.ts';
import { SHOWN_LINE } from './visual-tools.ts';

const ESCAPES: Readonly<Record<string, string>> = { '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' };

const LIMIT_MESSAGE = `limit takes a whole number from 1 to ${DATABASE_QUERY_MAX_ROWS}`;

const CONNECTION_INPUT = z
    .string({ error: 'connection needs the id or the name of a connection; database_list names them' })
    .min(1, 'connection needs the id or the name of a connection; database_list names them');

const SCHEMA_INPUT = z.string().min(1, 'schema needs the name of a schema').optional();

/* A text cell on one tab-separated line, readable back byte for byte. */
function escapedText(text: string): string {
    return text.replace(/[\\\t\n\r]/g, (char) => ESCAPES[char]!);
}

function cellText(cell: Cell): string {
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

function sqlInput(tool: string, needs: string) {
    const message = `${tool} needs ${needs} in sql`;

    return z.string({ error: message }).trim().min(1, message);
}

const databaseList = defineActionTool('database', {
    name: 'database_list',
    action: 'database.list',
    description: 'Lists the database connections of the project.',
    annotations: { readOnly: true },
    audience: 'database',
    input: z.object({}),
    async run(_input, call) {
        const { connections } = await runAction(call, 'database.list', {});
        const lines = connections.map((connection) =>
            [
                field(connection.id),
                field(connection.name),
                connection.engine,
                field(connection.target),
                connection.outsideProject ? 'outside-project' : connection.access
            ].join('\t')
        );

        return orNote(lines, 'This project has no database connections; a person adds them in the Databases panel of the app');
    }
});

const databaseTables = defineActionTool('database', {
    name: 'database_tables',
    action: 'database.tables',
    description: 'Lists the schemas of a connection and the tables and views of one.',
    annotations: { readOnly: true },
    audience: 'database',
    input: z.object({ connection: CONNECTION_INPUT, schema: SCHEMA_INPUT }),
    async run(input, call) {
        const listed = await runAction(call, 'database.tables', { connection: input.connection, schema: input.schema ?? null });
        const tables = listed.tables.map(
            (table) => `table\t${field(table.schema)}\t${field(table.name)}\t${table.kind}\t${table.rowEstimate === null ? '-' : table.rowEstimate}`
        );

        return [
            ...listed.schemas.map((schema) => `schema\t${field(schema)}`),
            ...orNote(tables, 'No table or view in the listed schemas; name another with schema')
        ];
    }
});

const databaseDescribe = defineActionTool('database', {
    name: 'database_describe',
    action: 'database.describe',
    description: 'Describes the columns, keys and indexes of a table or view.',
    annotations: { readOnly: true },
    audience: 'database',
    input: z.object({
        connection: CONNECTION_INPUT,
        table: z
            .string({ error: 'table needs the name of a table; database_tables lists them' })
            .min(1, 'table needs the name of a table; database_tables lists them'),
        schema: SCHEMA_INPUT
    }),
    async run(input, call) {
        const structure = await runAction(call, 'database.describe', { connection: input.connection, table: input.table, schema: input.schema ?? null });
        const primary = new Set(structure.primaryKey);

        return [
            `table\t${field(structure.schema)}\t${field(structure.name)}\t${structure.kind}`,
            ...structure.columns.map((column) => {
                const flags = [
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
                    flags.length === 0 ? '-' : flags.join(',')
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

const databaseQuery = defineActionTool('database', {
    name: 'database_query',
    action: 'database.query',
    description: 'Runs one SELECT or WITH read-only and answers its first rows.',
    annotations: { readOnly: true },
    audience: 'database',
    input: z.object({
        connection: CONNECTION_INPUT,
        schema: SCHEMA_INPUT,
        limit: z
            .number({ error: LIMIT_MESSAGE })
            .int(LIMIT_MESSAGE)
            .min(1, LIMIT_MESSAGE)
            .max(DATABASE_QUERY_MAX_ROWS, `limit is at most ${DATABASE_QUERY_MAX_ROWS}; narrow the query instead`)
            .optional(),
        show: z
            .string()
            .trim()
            .min(1, 'show needs a title, a few words that say what the table shows')
            .max(VISUAL_LIMITS.title, `show takes a title of at most ${VISUAL_LIMITS.title} characters`)
            .optional()
            .describe('Shows the rows in this chat under this title'),
        sql: sqlInput('database_query', 'one SELECT or WITH statement')
    }),
    async run(input, call) {
        const query = await runAction(call, 'database.query', {
            connection: input.connection,
            sql: input.sql,
            schema: input.schema ?? null,
            limit: input.limit ?? null,
            show: input.show ?? null
        });
        const limit = input.limit ?? DATABASE_QUERY_ROWS;
        const more =
            limit < DATABASE_QUERY_MAX_ROWS
                ? `The result holds more rows than these ${query.rows.length}; raise limit, at most ${DATABASE_QUERY_MAX_ROWS}, or narrow the query`
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
            ...rowsLines(result, `This statement read more rows than these ${result.rows.length}; database_query reads more of one`),
            elapsed(result.elapsedMs)
        ];
    }

    if (result.kind === 'done') {
        const id = result.lastInsertId === null ? '' : `\tlast-insert-id\t${result.lastInsertId}`;

        return [head, `done\t${result.affected}${id}`, elapsed(result.elapsedMs)];
    }

    return [head];
}

const databaseExecute = defineActionTool('database', {
    name: 'database_execute',
    action: 'database.execute',
    description: 'Runs statements on a connection a person opened to agent writes.',
    annotations: { destructive: true },
    audience: 'database',
    input: z.object({
        connection: CONNECTION_INPUT,
        schema: SCHEMA_INPUT,
        sql: sqlInput('database_execute', 'the statements to run').describe('Statements separated by semicolons')
    }),
    async run(input, call) {
        const executed = await runAction(call, 'database.execute', { connection: input.connection, sql: input.sql, schema: input.schema ?? null });
        const results = executed.results as unknown as StatementResult[];
        const lines: string[] = [];

        for (const [index, result] of results.entries()) {
            if (result.kind === 'error') {
                const state = result.error.sqlState === undefined ? '' : ` (SQLSTATE ${result.error.sqlState})`;

                throw new ToolRefusal(result.error.code, `Statement ${index + 1} failed: ${result.error.message}${state}`, [
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

export const databaseToolkit = defineToolkit('database', [databaseList, databaseTables, databaseDescribe, databaseQuery, databaseExecute]);
