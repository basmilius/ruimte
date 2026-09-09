import { rename, writeFile } from 'node:fs/promises';

// Windows can refuse a rename while a watcher or an indexer holds the target; a few short retries cover it.
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 40;

const isTransient = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');

// Two writes of the same file in flight at once (a fire-and-forget save next to an awaited one) must not share a temp name.
let nextTemp = 0;

// A crash between the two steps leaves a stray temp file, never a half-written file.
export const writeAtomic = async (target: string, content: string, mode = 0o600): Promise<void> => {
    const temp = `${target}.${process.pid}-${nextTemp++}.tmp`;
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

export const isNotFound = (e: unknown): boolean => typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
