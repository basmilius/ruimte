import { isUnderFolder } from '@/state/fs-watch';

const MAX_FOLDERS = 3;

export interface PathCrumbs {
    /* The folders on the way to the file, nearest last, with `…` first when the path is longer than it shows. */
    folders: string[];
    name: string;
}

/* A file's place for a breadcrumb: below the project folder when it is in it, otherwise the end of its own path. */
export function pathCrumbs(path: string, folder: string | null): PathCrumbs {
    const relative = folder !== null && isUnderFolder(path, folder) ? path.slice(folder.length + 1) : path;
    const segments = relative.split(/[\\/]/).filter((segment) => segment !== '');
    const name = segments.pop() ?? path;
    return { folders: segments.length > MAX_FOLDERS ? ['…', ...segments.slice(-MAX_FOLDERS)] : segments, name };
}
