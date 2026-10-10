import { createDatabaseClient, type DatabaseClient } from '@adecore/database';
import type { DatabaseResponse } from '@adecore/database/protocol';
import { performAsPerson } from '@/actions/client-actions';
import { databaseConnections, useDatabaseConnections } from '@/database/connections';
import { snapshotTrigger } from '@/database/snapshot-triggers';
import { ensureSqlBindings, sqlBindings } from '@/database/sql-bindings';
import { endpointKey } from '@/state/keys';
import { defaultProjectStore } from '@/state/project';
import { useWindow, windowWorkspace } from '@/state/window';

let current: { key: string; client: DatabaseClient } | null = null;
let following = false;

/* The machine and the project of the window, which is whose client there is. */
function windowKey(): string | null {
    const workspace = windowWorkspace();
    const project = defaultProjectStore.getState().current;
    return workspace === null || project === null ? null : endpointKey(workspace.connection.endpointId, project.projectId);
}

/* A workspace that goes, or moves to another project, takes its client with it, and the sessions it holds on the machine. */
function follow(): void {
    if (current !== null && windowKey() !== current.key) {
        void current.client.dispose();
        current = null;
    }
}

/*
 * One client per workspace, shared by every database surface so they use one session on the machine. Every
 * request goes as a person's action. Reading a connection's tree and a statement that changes a schema both
 * have the machine take its schema snapshots again.
 */
export function databaseClientFor(key: string): DatabaseClient {
    if (current?.key === key) {
        return current.client;
    }
    if (current !== null) {
        void current.client.dispose();
    }
    ensureSqlBindings();
    const observe = snapshotTrigger(
        () => databaseConnections.list(useDatabaseConnections.getState()),
        (connectionId) => sqlBindings.refresh(connectionId)
    );
    const client = createDatabaseClient(async (request) => {
        const response = (await performAsPerson('database.request', { request })).response as DatabaseResponse;
        observe({ request, response });
        return response;
    });
    // A statement that changed a schema leaves the snapshot the language servers read behind; a machine that cannot take one again says nothing.
    client.onSchemaChange((change) => {
        void sqlBindings.refresh(change.connectionId, change.schema).catch(() => undefined);
    });
    current = { key, client };
    if (!following) {
        following = true;
        useWindow.subscribe(follow);
        defaultProjectStore.subscribe(follow);
    }
    return client;
}
