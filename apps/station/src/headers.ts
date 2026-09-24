import { cspString } from '@ruimte/csp';

/*
 * The client's policy, tightened for a page on the public web. A daemon serves a paired host that
 * can be any address, which is why it allows plain `http:` and `ws:` and lets a page be framed;
 * nothing reaches the station over anything but TLS, and nothing may frame it or post out of it.
 */
export const CONTENT_SECURITY_POLICY = cspString({
    'base-uri': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", 'https://pulsar.ruimte.app', 'wss:', 'https:'],
    'manifest-src': ["'self'"]
});

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    // Two years, the length the preload list asks for; the subdomains of `station` are nothing, so including them costs nothing.
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    // A login returns here with a code in the query; no link out of the page should carry this address along.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/*
 * Every answer with the headers above. Vite names what is under `/assets/` after its content, so those
 * never change and are cached for a year; everything else (the page, the manifest) is asked for again,
 * so a deploy reaches a person on the next load.
 */
export const withSecurityHeaders = (response: Response, pathname: string): Response => {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        headers.set(name, value);
    }
    if (response.ok) {
        headers.set('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

/*
 * A path under `/assets/` that is no file would get the page from `not_found_handling`, cached for a year
 * as if it were that chunk. A tab left open over a deploy asks for a chunk that is gone, and has to see it fail.
 */
export const notFoundForMissingAsset = (response: Response, pathname: string): Response => {
    if (!pathname.startsWith('/assets/') || !response.headers.get('content-type')?.startsWith('text/html')) {
        return response;
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};
