import type { Area } from '../area.ts';
import { isOwner } from '../auth/access.ts';
import type { AgentDatabases } from '../database/agent-databases.ts';
import type { DatabaseConnectionStore } from '../database/connection-store.ts';
import type { DatabaseService } from '../database/database-service.ts';
import type { SqlAnalysis } from '../database/sql-analysis.ts';
import type { Dispatcher } from '../dispatcher.ts';

export interface DatabaseDeps {
    service: DatabaseService;
    connections: DatabaseConnectionStore;
    agents: Pick<AgentDatabases, 'accessFor' | 'setAccess' | 'handPasswords' | 'subscribe' | 'close'>;
    sql: Pick<SqlAnalysis, 'state' | 'bind' | 'refresh' | 'passwordsHanded' | 'subscribe'>;
}

/* A client is its own owner of database sessions, so one socket never reaches another's. */
export function databaseArea(deps: DatabaseDeps): Area {
    const { service, connections, agents, sql } = deps;

    return {
        name: 'database',
        sources: [connections, agents, sql],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        closed: (clientId) => service.release(clientId),
        stop: [
            { phase: 'end', label: 'Closing database connections', run: () => connections.closeAll() },
            { phase: 'end', label: 'Closing database agents', run: () => agents.close() },
            { phase: 'end', label: 'Stopping the database helper', run: () => service.dispose() }
        ]
    };
}

/* The wire leaves the payload of `database.request` opaque (the package's own protocol), so only its `method` is looked at. */
function isExecute(payload: unknown): boolean {
    return typeof payload === 'object' && payload !== null && 'method' in payload && payload.method === 'execute';
}

function registerRequests(dispatcher: Dispatcher, { service, connections, agents, sql }: DatabaseDeps): void {
    dispatcher.register('database.request', (payload, client) => service.handle(payload, client.id, isOwner(client.access)), {
        count: (payload) => (isExecute(payload) ? ['actions.database', 'database.queries'] : ['actions.database'])
    });

    dispatcher.register('database.connections', (payload, client) => connections.read(payload.projectId, client.id));

    dispatcher.register('database.connections.save', (payload, client) => connections.save(payload.projectId, payload.baseRev, payload.connections, client.id));

    dispatcher.register('database.agentAccess', (payload, client) => agents.accessFor(payload.projectId, client.id));

    // Letting agents write is a person-on-this-machine thing, the way approving a command is.
    dispatcher.register('database.agentAccess.set', (payload, client) =>
        agents.setAccess(payload.projectId, payload.connectionId, payload.access, client.id, isOwner(client.access))
    );

    dispatcher.register('database.passwords', async (payload, client) => {
        await agents.handPasswords(payload.projectId, client.id, payload.passwords);
        sql.passwordsHanded(payload.projectId);
        return {};
    });

    dispatcher.register('language.sql', (payload, client) => sql.state(payload.projectId, client.id));

    dispatcher.register('language.sql.bind', (payload, client) => sql.bind(payload.projectId, payload.path, payload.binding, client.id));

    dispatcher.register('database.snapshot.refresh', async (payload, client) => {
        await sql.refresh(payload.projectId, client.id, payload.connectionId, payload.schema);
        return {};
    });
}
