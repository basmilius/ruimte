import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { DatabaseAgentAccessSchema, type DatabaseAgentAccess } from '@ruimte/contracts';
import { z } from 'zod';

const AccessRecordSchema = z.object({
    projectId: z.string().min(1),
    connections: z.record(z.string(), DatabaseAgentAccessSchema),
    // Per connection set to write, the destination it was granted for; a write without one never holds.
    destinations: z.record(z.string(), z.string()).optional()
});

type AccessRecord = z.infer<typeof AccessRecordSchema>;

type DatabaseAccessGrant = { access: 'off' | 'read' } | { access: 'write'; destination: string };

/*
 * What the agents of a project may do with each of its database connections, as a person on one of
 * its clients set it. Under `$RUIMTE_HOME`, never in the project: an agent with a shell rewrites a
 * project file, and its own leave to write is never something it can give itself. A write holds only
 * for the destination it was granted for, since the id is the project file's and an agent can point
 * it elsewhere.
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

    /* What agents may do with a connection that points at `destination` now: a write granted for another reads `read`. */
    levelOf(projectId: string, connectionId: string, destination: string): DatabaseAgentAccess {
        const record = this.records.get(projectId);
        const access = record?.connections[connectionId] ?? 'read';
        if (access === 'write' && record?.destinations?.[connectionId] !== destination) {
            return 'read';
        }
        return access;
    }

    /* `read` is what an unset connection is, so setting it takes the entry out rather than writing it. */
    async set(projectId: string, connectionId: string, grant: DatabaseAccessGrant): Promise<void> {
        const record = this.records.get(projectId);
        const { [connectionId]: _access, ...connections } = record?.connections ?? {};
        const { [connectionId]: _destination, ...destinations } = record?.destinations ?? {};
        if (grant.access !== 'read') {
            connections[connectionId] = grant.access;
        }
        if (grant.access === 'write') {
            destinations[connectionId] = grant.destination;
        }
        await this.store(projectId, connections, destinations);
    }

    /*
     * Follows a change of the project's connections, given as id to destination: a connection that is
     * gone loses what was set for it and a write whose destination moved lapses, so neither comes back
     * with an id made again or a destination pointed back. True when anything was taken out.
     */
    async keep(projectId: string, current: Readonly<Record<string, string>>): Promise<boolean> {
        const record = this.records.get(projectId);
        if (!record) {
            return false;
        }
        const connections: Record<string, DatabaseAgentAccess> = {};
        const destinations: Record<string, string> = {};
        for (const [connectionId, access] of Object.entries(record.connections)) {
            const destination = current[connectionId];
            if (destination === undefined) {
                continue;
            }
            if (access !== 'write') {
                connections[connectionId] = access;
            } else if (record.destinations?.[connectionId] === destination) {
                connections[connectionId] = access;
                destinations[connectionId] = destination;
            }
        }
        if (Object.keys(connections).length === Object.keys(record.connections).length) {
            return false;
        }
        await this.store(projectId, connections, destinations);
        return true;
    }

    private async store(projectId: string, connections: Record<string, DatabaseAgentAccess>, destinations: Record<string, string>): Promise<void> {
        if (Object.keys(connections).length === 0) {
            await this.records.remove(projectId);
            return;
        }
        await this.records.write({ projectId, connections, ...(Object.keys(destinations).length === 0 ? {} : { destinations }) });
    }
}
