import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { digestStream, type FileDigest } from '../disk/hash.ts';

/*
 * Everything the store does to a disk, so a test can stop it between two steps or fill the disk
 * without touching one. Paths are absolute and made by the store from ids it checked.
 */
export interface ArtifactFs {
    mkdir(path: string): Promise<void>;
    /* The names in a folder; empty for a folder that is not there. */
    list(path: string): Promise<string[]>;
    /* Null for a file that is not there. */
    readText(path: string): Promise<string | null>;
    /* Replaces the file whole, flushed to the disk before and after the rename. */
    writeDurable(path: string, text: string): Promise<void>;
    /* Adds bytes at the end of a file, made when it is not there; the caller checked that `offset` is where it ends. */
    append(path: string, bytes: Uint8Array): Promise<void>;
    /* Null for a file that is not there. */
    sizeOf(path: string): Promise<number | null>;
    /* Copies a file from outside the store, flushed, and answers what it wrote. */
    copyIn(from: string, to: string): Promise<FileDigest>;
    digest(path: string): Promise<FileDigest>;
    /* At most `length` bytes from the start of a file. */
    readHead(path: string, length: number): Promise<Uint8Array>;
    /* At most `length` bytes from `offset` on; fewer at the end of the file. */
    readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
    syncFile(path: string): Promise<void>;
    syncDir(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
    /* The volume a path is on; null when the system cannot tell. */
    volume(path: string): Promise<{ free: number; size: number } | null>;
}

async function syncPath(path: string): Promise<void> {
    // Windows cannot open a directory to flush it, and NTFS journals the rename itself.
    if (process.platform === 'win32') {
        return;
    }
    const handle = await open(path, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function unlessMissing<T>(read: Promise<T>, missing: T): Promise<T> {
    try {
        return await read;
    } catch (e) {
        if (isNotFound(e)) {
            return missing;
        }
        throw e;
    }
}

async function readSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
    return new Uint8Array(
        await Bun.file(path)
            .slice(offset, offset + length)
            .arrayBuffer()
    );
}

export const NODE_ARTIFACT_FS: ArtifactFs = {
    async mkdir(path) {
        await mkdir(path, { recursive: true, mode: 0o700 });
    },
    list: (path) => unlessMissing(readdir(path), []),
    readText: (path) => unlessMissing(readFile(path, 'utf8'), null),
    writeDurable: (path, text) => writeAtomic(path, text, 0o600, { durable: true }),
    async append(path, bytes) {
        const handle = await open(path, 'a', 0o600);
        try {
            await handle.write(bytes);
        } finally {
            await handle.close();
        }
    },
    sizeOf: (path) =>
        unlessMissing(
            stat(path).then((info) => info.size),
            null
        ),
    async copyIn(from, to) {
        const handle = await open(to, 'wx', 0o600);
        try {
            const digest = await digestStream(createReadStream(from), async (chunk) => {
                await handle.write(chunk);
            });
            await handle.sync();
            return digest;
        } finally {
            await handle.close();
        }
    },
    digest: (path) => digestStream(createReadStream(path)),
    readHead: (path, length) => readSlice(path, 0, length),
    readRange: readSlice,
    syncFile: syncPath,
    syncDir: syncPath,
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { recursive: true, force: true }),
    async volume(path) {
        try {
            const info = await statfs(path);
            return { free: info.bavail * info.bsize, size: info.blocks * info.bsize };
        } catch {
            return null;
        }
    }
};

/* Whether a failure is the disk running full, which the store answers as `disk-full` and never as a broken write. */
export function isDiskFull(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e.code === 'ENOSPC' || e.code === 'EDQUOT');
}
