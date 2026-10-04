// The daemon may speak Windows paths; a stored path speaks POSIX. A path that starts with a drive
// letter or a backslash is the only case where the separator is not a slash.
function separatorOf(root: string): string {
    return /^[a-zA-Z]:\\|^\\\\/.test(root) ? '\\' : '/';
}

function withoutTrailingSeparator(path: string): string {
    return path.endsWith('/') || path.endsWith('\\') ? path.slice(0, -1) : path;
}

/*
 * Whether a path is the folder itself or something under it. A bare `startsWith` also said yes to
 * `/repo-old` for a root of `/repo`, and what came out of that was `old/src/a.ts`, which resolves
 * back to a file in `/repo` that nobody meant. Only a separator right after the root makes one
 * folder part of the other. Both separators count: contracts has no node:path, and the daemon at
 * the other end may speak Windows.
 */
function isUnder(base: string, path: string): boolean {
    return path === base || (path.startsWith(base) && (path[base.length] === '/' || path[base.length] === '\\'));
}

/* An absolute path from the daemon as a folder-relative one: POSIX and relative to the folder. */
export function relativeTo(root: string, path: string): string {
    const base = withoutTrailingSeparator(root);
    if (!isUnder(base, path)) {
        // Outside the folder there is nothing to shorten, so the path keeps the form it arrived in.
        return path;
    }
    return path
        .slice(base.length + 1)
        .split('\\')
        .join('/');
}

/* The way back, so a row can be revealed, copied or opened on the daemon's machine. */
export function absoluteOf(root: string, treePath: string): string {
    const separator = separatorOf(root);
    const relative = withoutTrailingSeparator(treePath).split('/').join(separator);
    return relative === '' ? withoutTrailingSeparator(root) : `${withoutTrailingSeparator(root)}${separator}${relative}`;
}

/* A path that names its own root, on either kind of machine: a leading separator, or a drive letter. */
export function isAbsolutePath(path: string): boolean {
    return /^[\\/]/.test(path) || /^[a-zA-Z]:[\\/]/.test(path);
}

/*
 * A path the way a file node or a file view stores it, so the project file says the same thing in
 * every checkout: relative to the project folder, POSIX. A file outside that folder keeps the
 * absolute path it has, which is what `relativeTo` hands back for a path it cannot shorten.
 */
export function storedPathOf(folder: string | null, path: string): string {
    return folder === null ? path : relativeTo(folder, path);
}

/* The way back, to the path the daemon takes. Null for a stored path with no folder to resolve it
   against, which is a project without one. */
export function resolveStoredPath(folder: string | null, path: string): string | null {
    if (isAbsolutePath(path)) {
        return path;
    }
    return folder === null ? null : absoluteOf(folder, path);
}
