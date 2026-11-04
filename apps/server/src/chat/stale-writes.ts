import { join } from 'node:path';
import type { Reclaimed } from '../maintenance/maintenance.ts';
import { sweepFolder } from '../maintenance/sweep-folder.ts';

/* A write renames its temporary file within moments; one a day old lost its writer to a crash or a kill. */
const STALE_WRITE_AGE_MS = 24 * 60 * 60 * 1000;

/* The name an atomic write of the chat store gives its temporary file: `<file>.<pid>-<uuid>.tmp`, or `<file>.<pid>-<counter>.tmp` before ADE CORE 0.53.3. */
const TEMPORARY_WRITE = /\.\d+-[0-9a-f-]+\.tmp$/;

export function sweepStaleChatWrites(home: string, now: number, signal?: AbortSignal): Promise<Reclaimed> {
    const oldest = now - STALE_WRITE_AGE_MS;

    return sweepFolder(join(home, 'chats'), {
        expired: (name, modifiedMs) => TEMPORARY_WRITE.test(name) && modifiedMs < oldest,
        signal
    });
}
