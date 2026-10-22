import { isAbsolute, relative, sep } from 'node:path';

/* What the shell reads to decide on a path, injected so the decision is tested without a disk. */
export interface QuickLookFiles {
    /* The text of the daemon's `projects.json`, or null when there is none. */
    registry(): Promise<string | null>;
    /* The path with every link resolved, or null when it does not exist. */
    realpath(path: string): Promise<string | null>;
    isFile(path: string): Promise<boolean>;
}

/* The endpoint id the client gives the machine this app runs, the only one whose folders are on this disk. */
const LOCAL_KEY_PREFIX = 'local:';

/* The folder of a project in the daemon's registry, or null when the registry does not name it. */
export function registryFolderOf(registry: string, projectId: string): string | null {
    try {
        const parsed: unknown = JSON.parse(registry);
        const projects = typeof parsed === 'object' && parsed !== null ? (parsed as { projects?: unknown }).projects : undefined;
        if (!Array.isArray(projects)) {
            return null;
        }
        const entry: unknown = projects.find((candidate: unknown) => (candidate as { projectId?: unknown } | null)?.projectId === projectId);
        const folder = (entry as { folder?: unknown } | undefined)?.folder;
        return typeof folder === 'string' && isAbsolute(folder) ? folder : null;
    } catch {
        return null;
    }
}

/*
 * The file Quick Look may show for a window, or null. The page is not trusted with a path: only a
 * file inside the folder of the project the window shows, on this machine, once links are resolved.
 */
export async function quickLookPath(windowKey: string | null, requested: unknown, files: QuickLookFiles): Promise<string | null> {
    if (windowKey === null || !windowKey.startsWith(LOCAL_KEY_PREFIX) || typeof requested !== 'string' || !isAbsolute(requested)) {
        return null;
    }
    const registry = await files.registry();
    const folder = registry === null ? null : registryFolderOf(registry, windowKey.slice(LOCAL_KEY_PREFIX.length));
    if (folder === null) {
        return null;
    }
    const [realFolder, realFile] = await Promise.all([files.realpath(folder), files.realpath(requested)]);
    if (realFolder === null || realFile === null) {
        return null;
    }
    const inside = relative(realFolder, realFile);
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
        return null;
    }
    return (await files.isFile(realFile)) ? realFile : null;
}
