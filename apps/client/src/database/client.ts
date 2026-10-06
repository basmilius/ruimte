import { createDatabaseClient, type DatabaseClient } from '@adecore/database';
import type { DatabaseResponse } from '@adecore/database/protocol';
import { performAsPerson } from '@/actions/client-actions';
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
 * One client per workspace, which every surface that draws a database shares, so a table opened in
 * the cell and the explorer in the panel use one session on the machine. Every request goes as a
 * person's action, through the machine of the window's project.
 */
export function databaseClientFor(key: string): DatabaseClient {
    if (current?.key === key) {
        return current.client;
    }
    if (current !== null) {
        void current.client.dispose();
    }
    const client = createDatabaseClient(async (request) => (await performAsPerson('database.request', { request })).response as DatabaseResponse);
    current = { key, client };
    if (!following) {
        following = true;
        useWindow.subscribe(follow);
        defaultProjectStore.subscribe(follow);
    }
    return client;
}
