import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { UntrustedFolders } from '../../projects/untrusted.ts';

/*
 * Where a one-shot CLI run (commit message, conflict help, chat title) has its working directory. A
 * CLI loads the settings and hooks of the folder it starts in, so a folder made from another machine's
 * work gets an empty folder of the daemon's own instead; the prompt carries everything the run needs.
 */
export class OneShotPlace {
    private readonly empty: string;
    private readonly untrusted: Pick<UntrustedFolders, 'inFolder'>;

    constructor(home: string, untrusted: Pick<UntrustedFolders, 'inFolder'>) {
        this.empty = join(home, 'oneshot');
        this.untrusted = untrusted;
    }

    async cwdFor(folder: string): Promise<string> {
        if (!this.untrusted.inFolder(folder)) {
            return folder;
        }
        await mkdir(this.empty, { recursive: true });
        return this.empty;
    }
}
