/*
 * The Content Security Policy the client runs under, as data. Three places serve the same page and
 * each wrote the policy out in full: the `<meta http-equiv>` in `apps/client/index.html` (which is
 * what covers the Vite dev server and an Electron window, since a window without one has no policy
 * at all and `eval` is free), the header the daemon sends with the client it serves, and the header
 * the station worker sends. The html cannot import, so a test holds its tag against this table.
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/*
 * `connect-src`, `img-src` and `media-src` are wide because a paired machine is any host the person
 * adds, and its socket, images, attachments and file bytes all come from there. Shiki needs
 * WebAssembly and the UI libraries inject styles, which is what the other two exceptions are for.
 */
export const CLIENT_CSP_DIRECTIVES = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
    'worker-src': ["'self'", 'blob:']
} satisfies CspDirectives;

/* The policy as a header value. An override replaces a directive whole, and a name that is not in the table is added to the end. */
export const cspString = (overrides: CspDirectives = {}): string =>
    Object.entries({ ...CLIENT_CSP_DIRECTIVES, ...overrides })
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
