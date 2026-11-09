import { join } from 'node:path';
import { settled, type Settled, type WatchSeams } from '@adecore/agents';
import { PRIVATE_DIR, PROJECT_DIR } from '@ruimte/contracts';
import { PROJECT_FILE, WATCH_SETTLE_MS, watchFolderChain } from './project-files.ts';

interface Watched {
    folder: string;
    chain: { close(): void };
    settle: Settled;
}

/*
 * Hears the shared and the private file of every project it is given change from outside the daemon. A
 * project a client holds has a watcher of its own, so this is for the others, whose edit no client would hear of.
 */
export class ProjectFolderWatch {
    private readonly seams: WatchSeams;
    private readonly changed: (projectId: string) => void;
    private readonly watched = new Map<string, Watched>();

    constructor(seams: WatchSeams, changed: (projectId: string) => void) {
        this.seams = seams;
        this.changed = changed;
    }

    /* Watches exactly these projects, by folder: new ones start, the ones no longer given stop. */
    sync(folders: ReadonlyMap<string, string>): void {
        for (const [projectId, watch] of this.watched) {
            if (folders.get(projectId) !== watch.folder) {
                this.forget(projectId);
            }
        }

        for (const [projectId, folder] of folders) {
            if (!this.watched.has(projectId)) {
                this.watch(projectId, folder);
            }
        }
    }

    close(): void {
        for (const projectId of [...this.watched.keys()]) {
            this.forget(projectId);
        }
    }

    private watch(projectId: string, folder: string): void {
        const settle = settled(this.seams, WATCH_SETTLE_MS, () => this.changed(projectId));
        // The folder each depth of the chain holds, whose coming or going takes the files under it along.
        const below = [PROJECT_DIR, PRIVATE_DIR];

        const chain = watchFolderChain(this.seams, [folder, join(folder, PROJECT_DIR), join(folder, PROJECT_DIR, PRIVATE_DIR)], (depth, filename) => {
            if (filename === null || filename === below[depth] || (depth > 0 && filename === PROJECT_FILE)) {
                settle.nudge();
            }
        });

        this.watched.set(projectId, { folder, chain, settle });
    }

    private forget(projectId: string): void {
        const watch = this.watched.get(projectId);
        watch?.chain.close();
        watch?.settle.stop();
        this.watched.delete(projectId);
    }
}
