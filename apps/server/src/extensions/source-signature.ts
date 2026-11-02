import { lstatSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_FOLDER, STAGING_PREFIX } from './pack.ts';

const LEFT_OUT = new Set([BUILD_FOLDER, 'node_modules', '.git']);

/* Whether a path in the project, as a watcher names it, is outside what a save changes: its first segment says. */
export function isLeftOut(path: string): boolean {
    const first = path.split(/[\\/]/)[0] ?? '';

    return LEFT_OUT.has(first) || first.startsWith(STAGING_PREFIX);
}

/* A linked file by its time and size, a linked folder only by where it points. A broken link or a loop is nothing. */
function linkedStats(path: string): string {
    try {
        const stats = statSync(path);

        return stats.isDirectory() ? 'folder' : `${stats.mtimeMs}:${stats.size}`;
    } catch {
        return 'missing';
    }
}

/*
 * What a project's sources are right now, by path, time and size. A watcher also fires for what a build does
 * to a file without changing it (copying a folder clones it on APFS), so only a different answer here is a save.
 * A link to a folder counts by where it points and is never followed, so one back into the project ends.
 */
export function sourceSignature(folder: string, prefix = ''): string {
    return readdirSync(folder)
        .filter((name) => !isLeftOut(name))
        .toSorted()
        .map((name) => {
            const path = join(folder, name);
            const stats = lstatSync(path, { throwIfNoEntry: false });

            if (stats === undefined) {
                return '';
            }

            if (stats.isSymbolicLink()) {
                return `${prefix}${name}->${readlinkSync(path)}:${linkedStats(path)}\n`;
            }

            if (stats.isDirectory()) {
                return sourceSignature(path, `${prefix}${name}/`);
            }

            return `${prefix}${name}:${stats.mtimeMs}:${stats.size}\n`;
        })
        .join('');
}
