import { isOwner } from '../auth/access.ts';
import { translate, type Dispatcher } from '../dispatcher.ts';
import type { DatabaseConnectionStore } from '../database/connection-store.ts';
import type { DatabaseService } from '../database/database-service.ts';

/* A client is its own owner of database sessions, so one socket never reaches another's. */
export function registerDatabaseHandlers(dispatcher: Dispatcher, service: DatabaseService, connections: DatabaseConnectionStore): void {
    dispatcher.register('database.request', (payload, client) => service.handle(payload, client.id, isOwner(client.access)));

    dispatcher.register('database.connections', (payload, client) => translate(() => connections.read(payload.projectId, client.id)));

    dispatcher.register('database.connections.save', (payload, client) =>
        translate(() => connections.save(payload.projectId, payload.baseRev, payload.connections, client.id))
    );
}
