import type { ProjectDatabaseTarget } from '@ruimte/contracts';
import type { AgentConnection } from '../database/agent-databases.ts';

/* An identifier as both engines read it: MySQL and SQLite each take backticks, a backtick inside doubled. */
function quoted(name: string): string {
    return `\`${name.replaceAll('`', '``')}\``;
}

/* The tool call that reads what the view shows, ready to make: its rows, or for a structure view the columns. */
function readCommand(view: ProjectDatabaseTarget, connection: string): string {
    const schema = view.schema === '' ? {} : { schema: view.schema };
    if (view.mode === 'structure') {
        return `database_describe ${JSON.stringify({ connection, table: view.table, ...schema })}`;
    }

    const where = view.where === undefined ? '' : ` WHERE ${view.where}`;

    return `database_query ${JSON.stringify({ connection, ...schema, sql: `SELECT * FROM ${quoted(view.table)}${where} LIMIT 50` })}`;
}

/*
 * A database view as an agent reads it: which table it shows and how, and the command that reads that
 * table. A connection this machine does not have is said, not refused: the view is one person's tab,
 * and another machine may keep the connection the view was made on.
 */
export function renderDatabaseView(name: string, view: ProjectDatabaseTarget, connection: AgentConnection | null): string {
    const lines = [
        `# Database view ${JSON.stringify(name)}`,
        '',
        `connection: ${connection === null ? `${view.connectionId} (not on this machine)` : `${connection.name} (${connection.id}, ${connection.engine}, ${connection.access})`}`,
        `schema: ${view.schema === '' ? '-' : view.schema}`,
        `table: ${view.table}`,
        `mode: ${view.mode}`,
        `filter: ${view.where ?? '-'}`,
        ''
    ];
    if (connection === null) {
        lines.push('This machine has no connection under that id, so the table cannot be read here; database_list lists the ones it has.');
    } else {
        lines.push('Read it with:', '', readCommand(view, connection.id));
    }
    return lines.join('\n');
}
