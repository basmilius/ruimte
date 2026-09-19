import { renameSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

// Windows can refuse a rename while a watcher or an indexer holds the target; a few short retries cover it.
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 40;

const isTransient = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');

// Two writes of the same file in flight at once (a fire-and-forget save next to an awaited one) must not share a temp name.
let nextTemp = 0;

/* Where a file waits while it is being written; the pid keeps two daemons over one home apart. */
export const tempNameFor = (target: string): string => `${target}.${process.pid}-${nextTemp++}.tmp`;

// A crash between the two steps leaves a stray temp file, never a half-written file.
export const writeAtomic = async (target: string, content: string | Uint8Array, mode = 0o600): Promise<void> => {
    const temp = tempNameFor(target);
    await writeFile(temp, content, { mode });
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(temp, target);
            return;
        } catch (e) {
            if (!isTransient(e) || attempt >= RENAME_RETRIES) {
                throw e;
            }
            await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS));
        }
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
            Bun.sleepSync(RENAME_RETRY_MS);
        }
    }
};

export const writeAtomicSync = (target: string, content: string | Uint8Array, mode = 0o600): void => {
    const temp = tempNameFor(target);
    writeFileSync(temp, content, { mode });
    replaceSync(temp, target);
};

export const isNotFound = (e: unknown): boolean => typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
