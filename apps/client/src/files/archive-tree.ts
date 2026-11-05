import { BYTES_READ_MAX_BYTES, type ArchiveEntry } from '@ruimte/contracts';

/*
 * The rows of the tree for an archive's entries. A folder is a row of its own only when nothing in the
 * listing is under it, the way the files panel draws an empty one; any other folder comes from the paths
 * of what it holds. A folder row ends in a slash, which is how the tree knows it.
 */
export function archiveTreePaths(entries: readonly ArchiveEntry[]): string[] {
    const parents = new Set<string>();
    for (const entry of entries) {
        const parts = entry.path.split('/');
        for (let i = 1; i < parts.length; i++) {
            parents.add(parts.slice(0, i).join('/'));
        }
    }
    return entries
        .filter((entry) => entry.kind !== 'directory' || !parents.has(entry.path))
        .map((entry) => (entry.kind === 'directory' ? `${entry.path}/` : entry.path));
}

/* The entry path a row of the tree stands for. */
export function entryPathOf(treePath: string): string {
    return treePath.replace(/\/+$/, '');
}

export function isFolderRow(treePath: string): boolean {
    return treePath.endsWith('/');
}

// Longest first, so `site.tar.gz` loses both of its extensions and not only the last one.
const ARCHIVE_SUFFIXES = ['.tar.gz', '.tgz', '.tar', '.zip', '.jar', '.gz'];

/* Whether a name says archive, which an entry inside an archive is opened as only once it is extracted. */
export function hasArchiveName(name: string): boolean {
    const lower = name.toLowerCase();
    return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/* The folder an archive is extracted into by default, named after it the way a file manager does. */
export function extractFolderName(archiveName: string): string {
    const lower = archiveName.toLowerCase();
    const suffix = ARCHIVE_SUFFIXES.find((candidate) => lower.endsWith(candidate) && lower.length > candidate.length);
    return suffix === undefined ? `${archiveName} folder` : archiveName.slice(0, archiveName.length - suffix.length);
}

/* `name`, or `name 2`, `name 3` and on while the folder already holds one of those. */
export function freeFolderName(name: string, taken: ReadonlySet<string>): string {
    if (!taken.has(name)) {
        return name;
    }
    let count = 2;
    while (taken.has(`${name} ${count}`)) {
        count++;
    }
    return `${name} ${count}`;
}

/* Whether a person's folder name is one name, and one a folder can carry. */
export function isFolderName(name: string): boolean {
    return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

interface ArchiveTotals {
    files: number;
    size: number;
    /* Null where the format does not say it per entry. */
    compressed: number | null;
}

export function archiveTotals(entries: readonly ArchiveEntry[]): ArchiveTotals {
    let files = 0;
    let size = 0;
    let compressed: number | null = 0;
    for (const entry of entries) {
        if (entry.kind !== 'file') {
            continue;
        }
        files++;
        size += entry.size;
        compressed = entry.compressedSize === undefined || compressed === null ? null : compressed + entry.compressedSize;
    }
    return { files, size, compressed };
}

/* Whether the machine hands out this entry whole, which saving it to this computer needs. */
export function canSaveEntry(entry: ArchiveEntry): boolean {
    return entry.kind === 'file' && entry.readable && entry.size <= BYTES_READ_MAX_BYTES;
}
