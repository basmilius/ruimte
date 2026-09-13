// The daemon may speak Windows paths; a stored path speaks POSIX. A path that starts with a drive
// letter or a backslash is the only case where the separator is not a slash.
const separatorOf = (root: string): string => (/^[a-zA-Z]:\\|^\\\\/.test(root) ? '\\' : '/');

const withoutTrailingSeparator = (path: string): string => (path.endsWith('/') || path.endsWith('\\') ? path.slice(0, -1) : path);

/* An absolute path from the daemon as a folder-relative one: POSIX and relative to the folder. */
export const relativeTo = (root: string, path: string): string => {
    const base = withoutTrailingSeparator(root);
    const relative = path.startsWith(base) ? path.slice(base.length + 1) : path;
    return relative.split('\\').join('/');
};

/* The way back, so a row can be revealed, copied or opened on the daemon's machine. */
export const absoluteOf = (root: string, treePath: string): string => {
    const separator = separatorOf(root);
    const relative = withoutTrailingSeparator(treePath).split('/').join(separator);
    return relative === '' ? withoutTrailingSeparator(root) : `${withoutTrailingSeparator(root)}${separator}${relative}`;
};

/* A path that names its own root, on either kind of machine: a leading separator, or a drive letter. */
export const isAbsolutePath = (path: string): boolean => /^[\\/]/.test(path) || /^[a-zA-Z]:[\\/]/.test(path);

/*
 * A path the way a file node or a file view stores it, so the project file says the same thing in
 * every checkout: relative to the project folder, POSIX. A file outside that folder keeps the
 * absolute path it has, which is what `relativeTo` hands back for a path it cannot shorten.
 */
export const storedPathOf = (folder: string | null, path: string): string => (folder === null ? path : relativeTo(folder, path));

/* The way back, to the path the daemon takes. Null for a stored path with no folder to resolve it
   against, which is a project without one. */
export const resolveStoredPath = (folder: string | null, path: string): string | null => {
    if (isAbsolutePath(path)) {
        return path;
    }
    return folder === null ? null : absoluteOf(folder, path);
};
