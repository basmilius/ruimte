import { globMatch } from './glob.ts';
import type { FileOperationFilter, FileRename } from './protocol.ts';

/* A file or folder that moves, which says what it is since a filter may take only one of the two. */
export interface RenamedFile extends FileRename {
    directory: boolean;
}

function filterTakes(filter: FileOperationFilter, file: RenamedFile): boolean {
    const { matches, glob, options } = filter.pattern;
    if (matches !== undefined && (matches === 'folder') !== file.directory) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(file.oldUri);
    } catch {
        return false;
    }
    if (filter.scheme !== undefined && filter.scheme !== url.protocol.slice(0, -1)) {
        return false;
    }
    const path = decodeURIComponent(url.pathname);
    return options?.ignoreCase === true ? globMatch(path.toLowerCase(), glob.toLowerCase()) : globMatch(path, glob);
}

/* The renames a server asked to hear about, by the filters it registered. A rename is matched on the place it leaves. */
export function renamesTaken(filters: readonly FileOperationFilter[], files: readonly RenamedFile[]): FileRename[] {
    return files.filter((file) => filters.some((filter) => filterTakes(filter, file))).map(({ oldUri, newUri }) => ({ oldUri, newUri }));
}
