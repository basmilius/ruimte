import { isOwner } from '../auth/access.ts';
import { translate, type Dispatcher } from '../dispatcher.ts';
import type { AgentDatabases } from '../database/agent-databases.ts';
import type { DatabaseConnectionStore } from '../database/connection-store.ts';
import type { DatabaseService } from '../database/database-service.ts';
import type { SqlAnalysis } from '../database/sql-analysis.ts';

/* A client is its own owner of database sessions, so one socket never reaches another's. */
export function registerDatabaseHandlers(
    dispatcher: Dispatcher,
    service: DatabaseService,
    connections: DatabaseConnectionStore,
    agents: Pick<AgentDatabases, 'accessFor' | 'setAccess' | 'handPasswords'>,
    sql?: Pick<SqlAnalysis, 'state' | 'bind' | 'refresh' | 'passwordsHanded'>
): void {
    dispatcher.register('database.request', (payload, client) => service.handle(payload, client.id, isOwner(client.access)));

    dispatcher.register('database.connections', (payload, client) => translate(() => connections.read(payload.projectId, client.id)));

    dispatcher.register('database.connections.save', (payload, client) =>
        translate(() => connections.save(payload.projectId, payload.baseRev, payload.connections, client.id))
    );

    dispatcher.register('database.agentAccess', (payload, client) => translate(() => agents.accessFor(payload.projectId, client.id)));

    // Letting agents write is a person-on-this-machine thing, the way approving a command is.
    dispatcher.register('database.agentAccess.set', (payload, client) =>
        translate(() => agents.setAccess(payload.projectId, payload.connectionId, payload.access, client.id, isOwner(client.access)))
    );

    dispatcher.register('database.passwords', (payload, client) =>
        translate(async () => {
            await agents.handPasswords(payload.projectId, client.id, payload.passwords);
            sql?.passwordsHanded(payload.projectId);
            return {};
        })
    );

    if (sql === undefined) {
        return;
    }

    dispatcher.register('language.sql', (payload, client) => translate(() => sql.state(payload.projectId, client.id)));

    dispatcher.register('language.sql.bind', (payload, client) => translate(() => sql.bind(payload.projectId, payload.path, payload.binding, client.id)));

    dispatcher.register('database.snapshot.refresh', (payload, client) =>
        translate(async () => {
            await sql.refresh(payload.projectId, client.id, payload.connectionId, payload.schema);
            return {};
        })
    );
}
