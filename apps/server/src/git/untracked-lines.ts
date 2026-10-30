import { lstat, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { Numstat } from './diff.ts';

// Git calls a file binary when a NUL shows up this far in (`buffer_is_binary`, xdiff-interface.c).
const BINARY_SNIFF_BYTES = 8000;
// Past `core.bigFileThreshold`'s default git does not read a file for a diff and calls it binary.
const BIG_FILE_BYTES = 512 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/*
 * What `git diff --numstat --no-index /dev/null <path>` says of an untracked file, read here instead of
 * in a process of its own: every line added, or binary. Anything but a regular file is null.
 */
export async function untrackedNumstat(root: string, path: string): Promise<Numstat | null> {
    const absolute = join(root, path);
    let size: number;
    try {
        const stat = await lstat(absolute);
        if (!stat.isFile()) {
            return null;
        }
        size = stat.size;
    } catch {
        return null;
    }
    if (size > BIG_FILE_BYTES) {
        return { path, added: 0, deleted: 0, binary: true };
    }
    let handle: FileHandle;
    try {
        handle = await open(absolute, 'r');
    } catch {
        return null;
    }
    try {
        const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        let read = 0;
        let newlines = 0;
        let last = NEWLINE;
        for (;;) {
            // The file can grow after lstat; one overflow byte distinguishes the exact-size limit.
            const length = Math.min(CHUNK_BYTES, BIG_FILE_BYTES - read + 1);
            const { bytesRead } = await handle.read(buffer, 0, length, null);
            if (bytesRead === 0) {
                break;
            }
            if (bytesRead > BIG_FILE_BYTES - read) {
                return { path, added: 0, deleted: 0, binary: true };
            }
            const chunk = buffer.subarray(0, bytesRead);
            if (read < BINARY_SNIFF_BYTES && chunk.subarray(0, BINARY_SNIFF_BYTES - read).includes(0)) {
                return { path, added: 0, deleted: 0, binary: true };
            }
            for (let at = chunk.indexOf(NEWLINE); at !== -1; at = chunk.indexOf(NEWLINE, at + 1)) {
                newlines += 1;
            }
            read += bytesRead;
            last = chunk[bytesRead - 1]!;
        }
        // A last line without its newline is a line all the same.
        return { path, added: newlines + (last === NEWLINE ? 0 : 1), deleted: 0, binary: false };
    } catch {
        return null;
    } finally {
        await handle.close();
    }
}
