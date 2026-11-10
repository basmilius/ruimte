/*
 * What the two Workers (the address book and the maps service) answer with, so a response, a status
 * and a header are spelled once. A Worker brings its own error vocabulary and the methods it allows.
 */

/*
 * Where the desktop app's own page lives: the shell serves the built client under this scheme, so the
 * page never depends on a daemon to exist. The daemon takes this origin beside loopback; a page on the
 * web cannot carry it.
 */
export const DESKTOP_APP_SCHEME = 'app';
export const DESKTOP_APP_ORIGIN = `${DESKTOP_APP_SCHEME}://ruimte`;

export const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

type ResponseHeaders = ConstructorParameters<typeof Headers>[0];

export function json(body: unknown, status = 200, headers: ResponseHeaders = {}): Response {
    const outgoing = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    new Headers(headers).forEach((value, name) => outgoing.set(name, value));
    return new Response(JSON.stringify(body), { status, headers: outgoing });
}

/* The answer for an error code of one vocabulary, with the status that vocabulary gives that code. */
export function failureOf<Code extends string>(statusOf: Readonly<Record<Code, number>>): (code: Code, message: string, headers?: ResponseHeaders) => Response {
    return (code, message, headers = {}) => json({ error: { code, message } }, statusOf[code], headers);
}

/*
 * The origin of a page that may read the answers: the desktop app, Vite on loopback and the listed web
 * clients. Tokens are bearer and never cookies, so this is about which pages may read the answers, not
 * about forged requests.
 */
export function allowedOrigin(request: Request, env: { ALLOWED_ORIGINS?: string }): string | null {
    const origin = request.headers.get('origin');
    if (!origin) {
        return null;
    }
    if (origin === DESKTOP_APP_ORIGIN || LOOPBACK_ORIGIN.test(origin)) {
        return origin;
    }
    const extra = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return extra.includes(origin) ? origin : null;
}

/* The ticket or token rides in `authorization`, so a request is not a simple one and every answer says who may read it. */
export function corsHeaders(methods: string): (origin: string | null) => Record<string, string> {
    return (origin): Record<string, string> => {
        if (!origin) {
            return { vary: 'Origin' };
        }
        return {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': methods,
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-max-age': '600',
            vary: 'Origin'
        };
    };
}
