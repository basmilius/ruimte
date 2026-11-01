import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LEFT_OUT = new Set(['dist', 'node_modules', '.git']);

/*
 * What a project's sources are right now, by path, time and size. A watcher also fires for what a build does
 * to a file without changing it (copying a folder clones it on APFS), so only a different answer here is a save.
 */
export function sourceSignature(folder: string, prefix = ''): string {
    return readdirSync(folder)
        .filter((name) => !LEFT_OUT.has(name))
        .toSorted()
        .map((name) => {
            const path = join(folder, name);
            const stats = statSync(path, { throwIfNoEntry: false });

            if (stats === undefined) {
                return '';
            }

            return stats.isDirectory() ? sourceSignature(path, `${prefix}${name}/`) : `${prefix}${name}:${stats.mtimeMs}:${stats.size}\n`;
        })
        .join('');
}
