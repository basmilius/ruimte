import { DATABASE_QUERY_ROWS, type ActionHandlers } from '@ruimte/actions';
import { MODE_ORDER } from '@adecore/agents/modes';
import { CodedError } from '@adecore/agents/coded-error';
import { VerbRefusal } from '../canvas/verb.ts';
import type { AgentQuery, DatabaseAgentHost } from '../database/agent-databases.ts';
import { tableVisual } from '../database/table-visual.ts';
import type { ServerActionContext } from './context.ts';
import { showVisual } from './visual-actions.ts';

export function databasesOf(context: ServerActionContext): DatabaseAgentHost {
    if (!context.host.databases) {
        throw new VerbRefusal('no-databases', 'This machine reaches no databases');
    }
    return context.host.databases;
}

/* The table above the reply, or why it is not there: the rows were read either way, so not showing them is no refusal. */
async function shownTable(context: ServerActionContext, caller: string, title: string, query: AgentQuery) {
    const html = tableVisual(query.result, { connection: query.connection, schema: query.schema });
    try {
        return { visual: await showVisual(context, caller, { title, html, maxHeight: null }) };
    } catch (e) {
        if (e instanceof CodedError) {
            return { reason: e.message };
        }
        throw e;
    }
}

export const databaseActions: ActionHandlers<ServerActionContext> = {
    'database.list': async (_input, { context }) => ({ output: { connections: await databasesOf(context).list(context.place) } }),
    'database.tables': async ({ connection, schema }, { actor, context }) => ({
        output: await databasesOf(context).tables(context.place, actor.id, connection, schema ?? null)
    }),
    'database.describe': async ({ connection, table, schema }, { actor, context }) => {
        const structure = await databasesOf(context).describe(context.place, actor.id, connection, table, schema ?? null);
        return {
            output: {
                schema: structure.schema,
                name: structure.name,
                kind: structure.kind,
                columns: structure.columns.map((column) => ({ ...column })),
                primaryKey: [...structure.primaryKey],
                indexes: structure.indexes.map((index) => ({ ...index, columns: [...index.columns] })),
                foreignKeys: structure.foreignKeys.map((key) => ({ ...key, columns: [...key.columns], referencedColumns: [...key.referencedColumns] }))
            }
        };
    },
    'database.query': async ({ connection, sql, schema, limit, show }, { actor, context }) => {
        const query = await databasesOf(context).query(context.place, actor.id, connection, sql, {
            schema: schema ?? null,
            limit: limit ?? DATABASE_QUERY_ROWS
        });
        const { columns, rows, hasMore, elapsedMs } = query.result;
        return {
            output: {
                connection: query.connection,
                schema: query.schema,
                columns: [...columns],
                rows: rows.map((row) => [...row]),
                hasMore,
                elapsedMs,
                shown: show === null || show === undefined ? null : await shownTable(context, actor.id, show, query)
            }
        };
    },
    'database.execute': async ({ connection, sql, schema }, { actor, context }) => {
        const mode = context.host.modeOf(actor.id);
        // The narrowest mode promises the person that nothing changes without asking them, and a statement cannot ask.
        if (mode === MODE_ORDER[0]) {
            throw new VerbRefusal(
                'database-write-mode',
                `You run in ${mode}, which changes nothing without asking the person, and a statement cannot ask; give them the statements to run, or ask them for a wider mode`
            );
        }
        const executed = await databasesOf(context).execute(context.place, actor.id, connection, sql, schema ?? null);
        return {
            output: { connection: executed.connection, results: executed.results.map((result) => ({ ...result })), inTransaction: executed.inTransaction }
        };
    }
};
