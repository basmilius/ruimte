/* The last segment of a path, whichever separator the daemon's machine uses. */
export function basenameOf(path: string): string {
    return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

export function isUnderFolder(path: string, ancestor: string): boolean {
    return path.startsWith(`${ancestor}/`) || path.startsWith(`${ancestor}\\`);
}

/* The folder a path sits in, which is what `fs.changed` names when something in it moves. */
export function dirnameOf(path: string): string {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut > 0 ? path.slice(0, cut) : path.slice(0, cut + 1);
}
