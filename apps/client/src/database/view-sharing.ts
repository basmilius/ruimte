import { useEffect } from 'react';
import { isDatabaseView, type DatabaseConnection, type ProjectView } from '@ruimte/contracts';
import { databaseConnections, ensureDatabaseConnections, useDatabaseConnectionList } from '@/database/connections';

/*
 * Why a database view cannot go in the shared file, or null when it can. A view names its connection by id
 * and the connection travels only when a person shared it (`databases.json`), so a view on a private
 * connection would arrive at a colleague as a table of a connection nobody has. The daemon cannot tell,
 * since it never reads which connections a project has when a view is saved; sharing is a person's own
 * `project.save`, so this is the place that holds it back.
 */
export function databaseViewShareRefusal(view: ProjectView, connections: readonly DatabaseConnection[] = currentConnections()): 'private-connection' | null {
    if (!isDatabaseView(view)) {
        return null;
    }
    return connections.some((connection) => connection.id === view.connectionId && connection.shared) ? null : 'private-connection';
}

function currentConnections(): readonly DatabaseConnection[] {
    return databaseConnections.list(databaseConnections.store.getState());
}

/* The same answer for a menu, which asks the machine for the connections once it is drawn for a database view. */
export function useDatabaseViewShareRefusal(view: ProjectView | undefined): 'private-connection' | null {
    const connections = useDatabaseConnectionList();
    const database = view !== undefined && isDatabaseView(view);
    useEffect(() => {
        if (database) {
            ensureDatabaseConnections();
        }
    }, [database]);
    return view === undefined ? null : databaseViewShareRefusal(view, connections);
}
