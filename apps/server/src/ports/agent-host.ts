import type { PortGrant, PortHost } from '@ruimte/contracts';
import { probeDevServers } from '../browser/dev-servers.ts';
import type { PortGrants } from './port-grants.ts';

/*
 * Sharing a development port with the person's other devices. `allowed` is the machine's switch, read at every call;
 * an agent lists the ports of its own project and stops only a share an agent made, never a person's.
 */
export interface PortShareHost {
    allowed(): boolean;
    /* Whether the address answers HTTP now, which is what a dev server is; a port that answers something else is not an agent's to share. */
    answersHttp(port: number, host: PortHost): Promise<boolean>;
    list(projectId: string): PortGrant[];
    share(projectId: string, port: number, host: PortHost): PortGrant;
    /* Whether a share of an agent in this project with this port was there to stop. */
    stop(projectId: string, port: number, host: PortHost): boolean;
}

interface PortShareDeps {
    allowed(): boolean;
    /* Read at every call: the grants are made after the services an agent reaches the daemon through. */
    grants(): PortGrants;
}

export function portShareHost({ allowed, grants }: PortShareDeps): PortShareHost {
    return {
        allowed,
        answersHttp: async (port, host) => (await probeDevServers([port], fetch, host)).length > 0,
        list: (projectId) =>
            grants()
                .list()
                .filter((grant) => grant.projectId === projectId),
        share: (projectId, port, host) => grants().share(projectId, port, host, 'agent'),
        stop: (projectId, port, host) => {
            const all = grants();
            // A share a person made is theirs to stop.
            const mine = all.list().find((grant) => grant.projectId === projectId && grant.port === port && grant.host === host && grant.sharedBy === 'agent');

            return mine !== undefined && all.revoke(mine.id);
        }
    };
}
