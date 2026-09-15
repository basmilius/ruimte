/*
 * The policy the web client runs under at `station.ruimte.app`. Stricter than the one the daemon sends
 * with the client it serves, because this origin is public and holds a session:
 *
 * - `script-src` has no inline script at all. `'wasm-unsafe-eval'` is Shiki's grammar engine, which is
 *   WebAssembly; nothing evaluates JavaScript from a string.
 * - `style-src` keeps `'unsafe-inline'`: xterm, CodeMirror and the markdown renderer put `<style>`
 *   elements in the page, and a style cannot run anything.
 * - `connect-src` is the page itself, the address book, any `wss:` (a broker, a machine's socket) and any
 *   `https:` (a machine behind a tunnel answers its challenge over HTTPS). Plain `ws:` and `http:` are
 *   out, which a browser refuses from an https page anyway. With `wss:` open to every host, closing
 *   `https:` would not stop a script that got in from sending anything anywhere, and it would break
 *   pairing with a machine behind a tunnel.
 * - Nothing may frame the page, and nothing is framed: a page from a machine is drawn by the desktop app.
 */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://pulsar.ruimte.app wss: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'"
].join('; ');

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
