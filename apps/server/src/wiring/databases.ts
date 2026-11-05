import { join } from 'node:path';
import { DatabaseAccessStore } from '../database/agent-access.ts';
import { AgentDatabases } from '../database/agent-databases.ts';
import { DatabasePasswords } from '../database/agent-passwords.ts';
import { DatabaseConnectionStore } from '../database/connection-store.ts';
import { DatabaseService } from '../database/database-service.ts';
import { SchemaSnapshots } from '../database/schema-snapshots.ts';
import { SqlAnalysis } from '../database/sql-analysis.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { errorText } from '../error-text.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { LanguageBundle } from './language.ts';

/* A project's databases, for a person through the views and for an agent through its tool. */
export interface DatabasesBundle {
    service: DatabaseService;
    connections: DatabaseConnectionStore;
    agents: AgentDatabases;
    sqlAnalysis: SqlAnalysis;
    snapshots: SchemaSnapshots;
}

export async function wireDatabases(
    home: string,
    machineHome: MachineHome,
    projects: ProjectStore,
    later: { language(): LanguageBundle }
): Promise<DatabasesBundle> {
    const service = new DatabaseService({ machineHome });
    const connections = new DatabaseConnectionStore({
        projects: { folderOf: (projectId) => projects.index.folderOf(projectId), holdersOf: (projectId) => projects.holdersOf(projectId) },
        onChanged: (projectId, changed) => {
            void agents
                .connectionsChanged(projectId, changed)
                .catch((e: unknown) => console.warn('Following a change of the connections for agents failed:', errorText(e)));
            void sqlAnalysis
                .connectionsChanged(projectId, changed)
                .catch((e: unknown) => console.warn('Following a change of the connections failed:', errorText(e)));
        }
    });
    const access = new DatabaseAccessStore(home);
    await access.load();
    const passwords = new DatabasePasswords();
    const agents = new AgentDatabases({
        service,
        connections,
        projects,
        access,
        passwords,
        scratchFolder: projects.scratchFolder
    });
    const snapshots = new SchemaSnapshots({
        root: join(home, 'database-snapshots'),
        service,
        passwordOf: (projectId, connectionId, target) => passwords.passwordOf(projectId, connectionId, target)
    });
    const sqlAnalysis = new SqlAnalysis({
        projects: {
            folderOf: (projectId) => projects.index.folderOf(projectId),
            holdersOf: (projectId) => projects.holdersOf(projectId),
            read: (projectId) => projects.read(projectId),
            mutate: (projectId, apply) => projects.mutate(projectId, apply)
        },
        connections,
        snapshots,
        access: agents,
        listeners: {
            sqlChanged: (projectId) => later.language().host.sqlChanged(projectId),
            outsideFilesChanged: (changes) => later.language().host.outsideFilesChanged(changes)
        }
    });
    return { service, connections, agents, sqlAnalysis, snapshots };
}
