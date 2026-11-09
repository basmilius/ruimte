import { isExternalActor } from '@ruimte/contracts';
import { bearerToken } from '../agents/bearer.ts';
import type { ExternalCaller } from '../canvas/external-caller.ts';
import { isPathSegment } from '../disk/path-segment.ts';

/* A session or chat of a project, which an agent's bearer token speaks for. */
export interface NodeCaller {
    readonly kind: 'node';
    readonly id: string;
}

/* Who asks `/mcp`: a node on the daemon's own port, an external client on the listener of its own. */
export type Caller = NodeCaller | ExternalCaller;

/*
 * The caller the request's bearer token speaks for; null for a missing or unknown token, and for a node
 * whose id, picked by a project file, could not name one folder under the machine's home.
 */
export function callerOf(request: Request, targetForToken: (token: string) => string | null): NodeCaller | null {
    const token = bearerToken(request);
    const id = token === null ? null : targetForToken(token);

    return id !== null && isPathSegment(id) && !isExternalActor(id) ? { kind: 'node', id } : null;
}
