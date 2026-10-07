import type { ProjectDatabaseTarget } from '@ruimte/contracts';

const FILTER_LENGTH = 24;

/*
 * What a database view is called until a person renames it: the table, with its filter when it has one so
 * two views of one table stay apart. The words are English, since the name is written into the project file.
 */
export function databaseViewName(target: Pick<ProjectDatabaseTarget, 'table' | 'mode' | 'where'>): string {
    if (target.mode === 'structure') {
        return `${target.table} (structure)`;
    }
    if (target.where === undefined) {
        return target.table;
    }
    const filter = target.where.replace(/\s+/g, ' ').trim();
    return `${target.table} (${filter.length > FILTER_LENGTH ? `${filter.slice(0, FILTER_LENGTH - 1).trimEnd()}…` : filter})`;
}

/* The view a loose table or structure tab becomes; a designer has no table to show yet. */
export function databaseTargetOf(tab: {
    kind: 'table' | 'structure' | 'designer';
    connectionId: string;
    schema: string;
    table?: string | undefined;
    where?: string | undefined;
    tableKind?: ProjectDatabaseTarget['tableKind'];
}): ProjectDatabaseTarget | null {
    if (tab.kind === 'designer' || tab.table === undefined) {
        return null;
    }
    return {
        connectionId: tab.connectionId,
        schema: tab.schema,
        table: tab.table,
        mode: tab.kind === 'table' ? 'data' : 'structure',
        ...(tab.kind === 'table' && tab.where !== undefined ? { where: tab.where } : {}),
        ...(tab.tableKind === undefined ? {} : { tableKind: tab.tableKind })
    };
}
