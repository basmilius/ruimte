export function bearerToken(request: Request): string | null {
    const header = request.headers.get('authorization') ?? '';

    return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/* The session or chat the request's bearer token speaks for; null for a missing or unknown token. */
export function bearerCaller(request: Request, targetForToken: (token: string) => string | null): string | null {
    const token = bearerToken(request);

    return token === null ? null : targetForToken(token);
}
