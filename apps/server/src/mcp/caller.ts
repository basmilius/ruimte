import { externalActorId, isExternalActor, type ExternalGrant } from '@ruimte/contracts';
import { bearerToken } from '../agents/bearer.ts';
import { isPathSegment } from '../fs/path-segment.ts';

/* A session or chat of a project, which an agent's bearer token speaks for. */
export interface NodeCaller {
    readonly kind: 'node';
    readonly id: string;
}

/* A client elsewhere that holds a credential a person made. It acts as that person, within the grant on the credential. */
export interface ExternalCaller {
    readonly kind: 'external';
    /* `external-<credential>`: apart from every node id and from Voice, so no lineage, claim or line ever mistakes it for one. */
    readonly id: string;
    readonly credentialId: string;
    /* The name a person reads for the client, taken at this request: a bearer's label, the host of an OAuth client's address. */
    readonly label: string;
    readonly grant: ExternalGrant;
}

/* Who asks `/mcp`: a node on the daemon's own port, an external client on the listener of its own. */
export type Caller = NodeCaller | ExternalCaller;

export { externalActorId, isExternalActor };

/* How a person reads an external client wherever it acted, such as the sender of a message. */
export function externalActorTitle(caller: ExternalCaller): string {
    return `MCP · ${caller.label}`;
}

/*
 * The caller the request's bearer token speaks for; null for a missing or unknown token, and for a node
 * whose id, picked by a project file, could not name one folder under the machine's home.
 */
export function callerOf(request: Request, targetForToken: (token: string) => string | null): NodeCaller | null {
    const token = bearerToken(request);
    const id = token === null ? null : targetForToken(token);

    return id !== null && isPathSegment(id) && !isExternalActor(id) ? { kind: 'node', id } : null;
}
