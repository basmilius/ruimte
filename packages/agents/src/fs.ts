import { renameSync, writeFileSync } from 'node:fs';
import { open, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Windows can refuse a rename while a watcher or an indexer holds the target; a few short retries cover it.
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 40;

// Node has no synchronous sleep; a wait on a value nobody changes is one.
const sleepSync = (ms: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const isTransient = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');

// Two writes of the same file in flight at once (a fire-and-forget save next to an awaited one) must not share a temp name.
let nextTemp = 0;

/* Where a file waits while it is being written; the pid keeps two daemons over one home apart. */
export const tempNameFor = (target: string): string => `${target}.${process.pid}-${nextTemp++}.tmp`;

export interface WriteAtomicOptions {
    /* Flushed to the disk before and after the rename, for a file whose loss costs a person their work. */
    durable?: boolean;
}

const writeFlushed = async (path: string, content: string | Uint8Array, mode: number): Promise<void> => {
    const handle = await open(path, 'w', mode);
    try {
        await handle.writeFile(content);
        await handle.sync();
    } finally {
        await handle.close();
    }
};

// Windows cannot open a directory to flush it, and NTFS journals the rename itself.
const syncDirectory = async (path: string): Promise<void> => {
    if (process.platform === 'win32') {
        return;
    }
    const handle = await open(path, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

/*
 * A crash between the two steps leaves a stray temp file, never a half-written file. That holds for
 * a process that dies; after a power cut APFS and ext4 can still hold an empty target, unless the
 * write is durable.
 */
export const writeAtomic = async (target: string, content: string | Uint8Array, mode = 0o600, options: WriteAtomicOptions = {}): Promise<void> => {
    const temp = tempNameFor(target);
    if (options.durable) {
        await writeFlushed(temp, content, mode);
    } else {
        await writeFile(temp, content, { mode });
    }
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(temp, target);
            break;
        } catch (e) {
            if (!isTransient(e) || attempt >= RENAME_RETRIES) {
                throw e;
            }
            await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS));
        }
    }
    if (options.durable) {
        await syncDirectory(dirname(target));
    }
};

/*
 * The same rename, without a turn of the event loop. A `bun --watch` reload restarts a module before
 * an awaited write comes back, and an exit path is gone before one lands, so what has to be on disk
 * before the process turns around goes through here.
 */
export const replaceSync = (temp: string, target: string): void => {
    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(temp, target);
            return;
        } catch (e) {
            if (!isTransient(e) || attempt >= RENAME_RETRIES) {
                throw e;
            }
            sleepSync(RENAME_RETRY_MS);
        }
    }
};

export const writeAtomicSync = (target: string, content: string | Uint8Array, mode = 0o600): void => {
    const temp = tempNameFor(target);
    writeFileSync(temp, content, { mode });
    replaceSync(temp, target);
};

export const isNotFound = (e: unknown): boolean => typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';

export const fileExists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};
