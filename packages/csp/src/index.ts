/*
 * The client's Content Security Policy as data, for the header of the desktop app's scheme and of the
 * station. The `<meta>` in `apps/client/index.html` covers Vite and an Electron window (without it
 * `eval` is free); html cannot import, so a test holds that tag against this table.
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/*
 * `connect-src`, `img-src` and `media-src` are wide because a machine's LAN door and broker are whatever
 * address it reports or a person picks. Shiki needs WebAssembly and the UI libraries inject styles. A
 * frame only ever shows a visual's sandbox host page, on the page's own origin.
 */
export const CLIENT_CSP_DIRECTIVES = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'self'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
    'worker-src': ["'self'", 'blob:']
} satisfies CspDirectives;

function directivesString(directives: CspDirectives): string {
    return Object.entries(directives)
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
}

/* The policy as a header value. An override replaces a directive whole, and a name that is not in the table is added to the end. */
export function cspString(overrides: CspDirectives = {}): string {
    return directivesString({ ...CLIENT_CSP_DIRECTIVES, ...overrides });
}

// On the client's own origin (Vite, the desktop scheme, the station); the frame's sandbox makes the page's origin opaque.
export const VISUAL_HOST_PATH = '/__visual/';

/*
 * An agent's page runs under this policy, never the client's: inline code and public sources such as a
 * CDN chart library. Plain `http:` and `ws:` only reach the person's own computer, so they stay out. The
 * sandbox repeats the frame's, so the page never gets the client's origin even when framed without one.
 */
export const VISUAL_HOST_CSP_DIRECTIVES = {
    'default-src': ["'none'"],
    'script-src': ["'unsafe-inline'", "'unsafe-eval'", 'https:', 'data:', 'blob:'],
    'style-src': ["'unsafe-inline'", 'https:', 'data:'],
    'img-src': ['https:', 'data:', 'blob:'],
    'font-src': ['https:', 'data:'],
    'media-src': ['https:', 'data:', 'blob:'],
    'connect-src': ['https:', 'wss:', 'data:', 'blob:'],
    'worker-src': ['blob:', 'data:'],
    'frame-src': ['https:', 'data:', 'blob:'],
    'form-action': ["'none'"],
    'base-uri': ["'none'"],
    'frame-ancestors': ["'self'"],
    sandbox: ['allow-scripts', 'allow-forms']
} satisfies CspDirectives;

export const VISUAL_HOST_CSP = directivesString(VISUAL_HOST_CSP_DIRECTIVES);

/* What every answer of the host page carries. No-cache, so a release that changes the page reaches a frame on its next load. */
export const VISUAL_HOST_HEADERS: Readonly<Record<string, string>> = {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': VISUAL_HOST_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-cache'
};
