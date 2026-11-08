import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { Numstat } from './diff.ts';

// Git calls a file binary when a NUL shows up this far in (`buffer_is_binary`, xdiff-interface.c).
const BINARY_SNIFF_BYTES = 8000;
// Past `core.bigFileThreshold`'s default git does not read a file for a diff and calls it binary.
const BIG_FILE_BYTES = 512 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;
const MAX_CACHED_FILES = 512;
// Fast writes can share a filesystem tick even when stat exposes nanosecond fields.
const RACY_WINDOW_MS = 2000;

interface FileVersion {
    key: string;
    size: bigint;
    dev: bigint;
    ino: bigint;
    changedAtNs: bigint;
}

interface CachedCount {
    version: string;
    result: Numstat;
}

const counts = new Map<string, CachedCount>();

async function versionOf(absolute: string): Promise<FileVersion | null> {
    try {
        const stat = await lstat(absolute, { bigint: true });

        if (!stat.isFile()) {
            return null;
        }

        return {
            key: [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'),
            size: stat.size,
            dev: stat.dev,
            ino: stat.ino,
            changedAtNs: stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs
        };
    } catch {
        return null;
    }
}

function remember(absolute: string, version: string, result: Numstat): void {
    counts.delete(absolute);

    if (counts.size >= MAX_CACHED_FILES) {
        const oldest = counts.keys().next().value;

        if (oldest !== undefined) {
            counts.delete(oldest);
        }
    }

    counts.set(absolute, { version, result: { ...result } });
}

/*
 * What `git diff --numstat --no-index /dev/null <path>` says of an untracked file, read here instead of
 * in a process of its own: every line added, or binary. Anything but a regular file is null.
 */
export async function untrackedNumstat(root: string, path: string, now: number = Date.now()): Promise<Numstat | null> {
    const absolute = join(root, path);
    const version = await versionOf(absolute);

    if (version === null) {
        counts.delete(absolute);

        return null;
    }

    const cached = counts.get(absolute);
    const reusable = version.changedAtNs > 0n && version.changedAtNs < BigInt(Math.floor(now - RACY_WINDOW_MS)) * 1_000_000n;

    if (reusable && cached?.version === version.key) {
        counts.delete(absolute);
        counts.set(absolute, cached);

        return { ...cached.result, path };
    }

    counts.delete(absolute);

    if (version.size > BigInt(BIG_FILE_BYTES)) {
        return { path, added: 0, deleted: 0, binary: true };
    }

    const result = await countFile(absolute, path, version);

    if (reusable && result !== null) {
        remember(absolute, version.key, result);
    }

    return result;
}

/* A file swapped for a FIFO after lstat would block an open that waits for a writer, and with it a thread of the pool. Windows has neither flag. */
export function openFlags(platform: NodeJS.Platform = process.platform): string | number {
    return platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
}

async function countFile(absolute: string, path: string, version: FileVersion): Promise<Numstat | null> {
    let handle: FileHandle;
    try {
        handle = await open(absolute, openFlags());
    } catch {
        return null;
    }
    try {
        const opened = await handle.stat({ bigint: true });

        if (!opened.isFile() || opened.dev !== version.dev || opened.ino !== version.ino) {
            return null;
        }

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
