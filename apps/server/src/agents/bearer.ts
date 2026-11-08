export function bearerToken(request: Request): string | null {
    const header = request.headers.get('authorization') ?? '';

    return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}
