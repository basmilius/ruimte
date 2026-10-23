import { cspString } from '@ruimte/csp';

/*
 * The client's policy, narrowed to what the comparison does: it reads the address book and nothing
 * else, draws its marks inline and frames nothing. Nothing may frame it or post out of it.
 */
export const CONTENT_SECURITY_POLICY = cspString({
    'base-uri': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'script-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'media-src': ["'none'"],
    'connect-src': ["'self'", 'https://pulsar.ruimte.app'],
    'worker-src': ["'none'"],
    'manifest-src': ["'self'"]
});

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/*
 * Every answer with the headers above. Vite names what is under `/assets/` after its content, so those
 * never change and are cached for a year; the page is asked for again, so a deploy reaches the next load.
 */
export function withSecurityHeaders(response: Response, pathname: string): Response {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        headers.set(name, value);
    }
    if (response.ok) {
        headers.set('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* A chunk that is gone after a deploy must fail, not come back as the page cached for a year. */
export function notFoundForMissingAsset(response: Response, pathname: string): Response {
    if (!pathname.startsWith('/assets/') || !response.headers.get('content-type')?.startsWith('text/html')) {
        return response;
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}
