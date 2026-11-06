import { isTempName } from '@adecore/utils/fs';
import { homeFolder } from '@ruimte/service/home';
import type { Reclaimed } from '../maintenance/maintenance.ts';
import { sweepFolder } from '../maintenance/sweep-folder.ts';

/* A write renames its temporary file within moments; one a day old lost its writer to a crash or a kill. */
const STALE_WRITE_AGE_MS = 24 * 60 * 60 * 1000;

export function sweepStaleChatWrites(home: string, now: number, signal?: AbortSignal): Promise<Reclaimed> {
    const oldest = now - STALE_WRITE_AGE_MS;

    return sweepFolder(homeFolder(home, 'chats'), {
        expired: (name, modifiedMs) => isTempName(name) && modifiedMs < oldest,
        signal
    });
}
