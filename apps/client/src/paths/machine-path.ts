/* How a machine writes its paths, which a window on another platform has to follow when it browses that machine. */

/* The daemon's separator, not this browser's: a Windows daemon answers in backslashes. */
export function separatorFor(platform: string | null): string {
    return platform === 'win32' ? '\\' : '/';
}

/* Both separators, because a path is typed by hand and the daemon accepts either. */
export function endsWithSeparator(path: string): boolean {
    return path.endsWith('/') || path.endsWith('\\');
}

/* A Windows machine takes a forward slash as a separator too, so a path typed that way splits like one the machine wrote. */
function isSeparator(char: string, sep: string): boolean {
    return char === sep || (sep === '\\' && char === '/');
}

function lastSeparator(path: string, sep: string): number {
    return sep === '\\' ? Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) : path.lastIndexOf(sep);
}

function withoutTrailing(path: string, sep: string): string {
    let end = path.length;
    while (end > 0 && isSeparator(path.slice(end - 1, end), sep)) {
        end -= 1;
    }
    return path.slice(0, end);
}

/*
 * One level up, ready to browse; null at a root (a drive letter or the home tilde). A cut at the very
 * front answers the separator itself rather than an empty string.
 */
export function parentOf(path: string, sep: string): string | null {
    const trimmed = withoutTrailing(path, sep);
    const cut = lastSeparator(trimmed, sep);
    if (cut < 0) {
        return null;
    }
    return cut === 0 ? sep : trimmed.slice(0, cut + 1);
}

export function lastSegment(path: string, sep: string): string {
    const trimmed = withoutTrailing(path, sep);
    const cut = lastSeparator(trimmed, sep);
    return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/*
 * The path to show once its first listing is in. A tilde means nothing to a person on Windows, so a
 * listed home folder is written as the machine wrote it (`parentPath`, which the machine answers
 * absolute); macOS and Linux keep the tilde.
 */
export function shownPath(path: string, parentPath: string | null, platform: string | null): string {
    if (platform !== 'win32' || parentPath === null || !path.startsWith('~') || !(path === '~' || endsWithSeparator(path))) {
        return path;
    }
    return endsWithSeparator(parentPath) ? parentPath : `${parentPath}${separatorFor(platform)}`;
}
