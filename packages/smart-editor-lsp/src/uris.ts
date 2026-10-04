function isWindowsDrive(segment: string): boolean {
    return /^[A-Za-z]:$/.test(segment);
}

/* An absolute path, POSIX or with a Windows drive, as the `file:` URI a language server names it by. */
export function pathToFileUri(path: string): string {
    const normalized = path.replaceAll('\\', '/');
    const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const segments = rooted.split('/').map((segment, index) => (index === 1 && isWindowsDrive(segment) ? segment : encodeURIComponent(segment)));
    return `file://${segments.join('/')}`;
}

/* The path behind a `file:` URI, in the form of the machine it names, or null for any other kind of URI. */
export function fileUriToPath(uri: string): string | null {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return null;
    }
    if (url.protocol !== 'file:') {
        return null;
    }
    const path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(path)) {
        return path.slice(1).replaceAll('/', '\\');
    }
    return path;
}
