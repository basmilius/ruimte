import { join } from 'node:path';
import { CodedError } from '@adecore/agents';
import { PortGrantSchema, type PortGrant, type PortHost } from '@ruimte/contracts';
import { z } from 'zod';
import { JsonFileStore } from '../json-file-store.ts';
import { deniedPortReason } from '../tunnels/tunnel-config.ts';

const PORTS_DIR = 'ports';

/* More than a person shares by hand, and few enough that the list stays one request. */
const MAX_PORT_GRANTS = 256;

const StoredPortsSchema = z.object({ version: z.literal(1), grants: z.array(PortGrantSchema).max(MAX_PORT_GRANTS) });
type StoredPorts = z.infer<typeof StoredPortsSchema>;

export class PortGrantError extends CodedError {}

export function portsStore(home: string | undefined): JsonFileStore<StoredPorts> {
    return new JsonFileStore(home === undefined ? undefined : join(home, PORTS_DIR, 'grants.json'), StoredPortsSchema, 'no port is shared');
}

interface PortGrantsOptions {
    store: JsonFileStore<StoredPorts>;
    /* The ports Ruimte listens on, which no grant may name; read again at every open. */
    deniedPorts(): readonly number[];
    random(bytes: number): string;
    now(): number;
    /* Tells every client the list moved. */
    changed(): void;
}

/*
 * The development ports a person shared, kept under `$RUIMTE_HOME` until someone revokes them. A grant is the
 * only way a client reaches a loopback service through the machine connection: discovery, a launch's port or a
 * URL in a project file grants nothing.
 */
export class PortGrants {
    private readonly options: PortGrantsOptions;
    private grants: PortGrant[];
    private readonly revokedListeners = new Set<(grant: PortGrant) => void>();

    constructor(options: PortGrantsOptions) {
        this.options = options;
        this.grants = options.store.read()?.grants ?? [];
    }

    list(): PortGrant[] {
        return [...this.grants];
    }

    find(id: string): PortGrant | undefined {
        return this.grants.find((grant) => grant.id === id);
    }

    /* Why the grant may not be used now, or null; asked at every open since the ports Ruimte listens on can change. */
    deniedReason(grant: PortGrant): string | null {
        return deniedPortReason(grant.port, this.options.deniedPorts());
    }

    /* Sharing the same endpoint of the same project twice answers the grant that exists. */
    share(projectId: string, port: number, host: PortHost, sharedBy: PortGrant['sharedBy']): PortGrant {
        const reason = deniedPortReason(port, this.options.deniedPorts());

        if (reason !== null) {
            throw new PortGrantError('port-denied', reason);
        }

        const existing = this.grants.find((grant) => grant.projectId === projectId && grant.port === port && grant.host === host);

        if (existing !== undefined) {
            return existing;
        }

        if (this.grants.length >= MAX_PORT_GRANTS) {
            throw new PortGrantError('too-many-grants', `Only ${MAX_PORT_GRANTS} ports can be shared at once. Stop sharing one first`);
        }

        const grant: PortGrant = {
            id: this.options.random(12),
            projectId,
            host,
            port,
            sharedBy,
            createdAt: this.options.now()
        };

        this.grants = [...this.grants, grant];
        this.save();

        return grant;
    }

    /* False for a grant that was gone already. Every stream of it ends before this returns. */
    revoke(id: string): boolean {
        const grant = this.find(id);

        if (grant === undefined) {
            return false;
        }

        this.grants = this.grants.filter((entry) => entry.id !== id);
        this.save();

        for (const listener of this.revokedListeners) {
            listener(grant);
        }

        return true;
    }

    onRevoked(listener: (grant: PortGrant) => void): () => void {
        this.revokedListeners.add(listener);

        return () => {
            this.revokedListeners.delete(listener);
        };
    }

    private save(): void {
        this.options.store.write({ version: 1, grants: this.grants });
        this.options.changed();
    }
}
