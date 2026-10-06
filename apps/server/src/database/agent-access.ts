import { join } from 'node:path';
import { DatabaseAgentAccessSchema, type DatabaseAgentAccess } from '@ruimte/contracts';
import { z } from 'zod';
import { RecordDirectory } from '@adecore/agents/record-directory';

const AccessRecordSchema = z.object({
    projectId: z.string().min(1),
    connections: z.record(z.string(), DatabaseAgentAccessSchema)
});

type AccessRecord = z.infer<typeof AccessRecordSchema>;

/*
 * What the agents of a project may do with each of its database connections, as a person on one of
 * its clients set it. Under `$RUIMTE_HOME`, never in the project: an agent with a shell rewrites a
 * project file, and its own leave to write is never something it can give itself.
 */
export class DatabaseAccessStore {
    private readonly records: RecordDirectory<AccessRecord>;

    constructor(home: string) {
        this.records = new RecordDirectory({ dir: join(home, 'database-access'), schema: AccessRecordSchema, idOf: (record) => record.projectId });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before anything can ask. */
    load(): Promise<void> {
        return this.records.load();
    }

    /* Only what a person set; a connection that is not in it is `read`. */
    levels(projectId: string): Record<string, DatabaseAgentAccess> {
        return { ...this.records.get(projectId)?.connections };
    }

    levelOf(projectId: string, connectionId: string): DatabaseAgentAccess {
        return this.records.get(projectId)?.connections[connectionId] ?? 'read';
    }

    /* `read` is what an unset connection is, so setting it takes the entry out rather than writing it. */
    async set(projectId: string, connectionId: string, access: DatabaseAgentAccess): Promise<Record<string, DatabaseAgentAccess>> {
        const { [connectionId]: _previous, ...rest } = this.levels(projectId);
        const connections = access === 'read' ? rest : { ...rest, [connectionId]: access };
        if (Object.keys(connections).length === 0) {
            await this.records.remove(projectId);
        } else {
            await this.records.write({ projectId, connections });
        }
        return { ...connections };
    }
}
