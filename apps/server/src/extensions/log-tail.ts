import { closeSync, openSync, readSync, statSync } from 'node:fs';

function sizeOf(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}

/* Each call answers what was added to a file since the last, from now on. A file that shrank starts over. */
export function logTail(path: string): () => string {
    let at = sizeOf(path);

    return () => {
        const size = sizeOf(path);

        if (size < at) {
            at = 0;
        }

        if (size === at) {
            return '';
        }

        const bytes = Buffer.alloc(size - at);
        const file = openSync(path, 'r');

        readSync(file, bytes, 0, bytes.length, at);
        closeSync(file);
        at = size;

        return bytes.toString('utf8');
    };
}
