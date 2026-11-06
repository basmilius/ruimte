import { isPathSegment } from '../disk/path-segment.ts';

export function bearerToken(request: Request): string | null {
    const header = request.headers.get('authorization') ?? '';

    return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/*
 * The session or chat the request's bearer token speaks for; null for a missing or unknown token, and for
 * a caller whose id, picked by a project file, could not name one folder under the machine's home.
 */
export function bearerCaller(request: Request, targetForToken: (token: string) => string | null): string | null {
    const token = bearerToken(request);
    const caller = token === null ? null : targetForToken(token);

    return caller !== null && isPathSegment(caller) ? caller : null;
}
