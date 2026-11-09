import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/*
 * Where an absolute path leads once it exists: the real path of its nearest ancestor that is there, with the
 * rest of the names after it. A create or a move resolves that ancestor's links and case before it writes.
 */
export async function realOfNearest(path: string): Promise<string> {
    const rest: string[] = [];
    let current = path;

    while (true) {
        const real = await realOrNull(current);

        if (real !== null) {
            return join(real, ...rest.reverse());
        }

        const parent = dirname(current);

        if (parent === current) {
            return path;
        }

        rest.push(basename(current));
        current = parent;
    }
}

export function realOrSelf(path: string): Promise<string> {
    return realpath(path).catch(() => path);
}

export function realOrNull(path: string): Promise<string | null> {
    return realpath(path).catch(() => null);
}
