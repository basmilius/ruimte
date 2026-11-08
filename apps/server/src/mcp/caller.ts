import { bearerToken } from '../agents/bearer.ts';
import { isPathSegment } from '../fs/path-segment.ts';

/* A session or chat of a project, which an agent's bearer token speaks for. */
export interface NodeCaller {
    readonly kind: 'node';
    readonly id: string;
}

/* Who asks `/mcp`. Only a node is in use here; the external route has a member of its own. */
export type Caller = NodeCaller;

/*
 * The caller the request's bearer token speaks for; null for a missing or unknown token, and for a node
 * whose id, picked by a project file, could not name one folder under the machine's home.
 */
export function callerOf(request: Request, targetForToken: (token: string) => string | null): Caller | null {
    const token = bearerToken(request);
    const id = token === null ? null : targetForToken(token);

    return id !== null && isPathSegment(id) ? { kind: 'node', id } : null;
}
