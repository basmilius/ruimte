import { join } from 'node:path';
import { settled, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { PRIVATE_DIR, PROJECT_DIR } from '@ruimte/contracts';
import { PROJECT_FILE, WATCH_SETTLE_MS, watchDirectories } from './project-files.ts';

interface Watched {
    folder: string;
    watchers: DirectoryWatcher[];
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
        const watchers: DirectoryWatcher[] = [];
        const hearsFile = (filename: string | null): boolean => filename === null || filename === PROJECT_FILE;
        let privateWatchers: DirectoryWatcher[] = [];
        // A folder that was removed leaves a watcher that never hears again, so each call replaces the last.
        const watchPrivate = (): boolean => {
            for (const watcher of privateWatchers) {
                watcher.close();
                watchers.splice(watchers.indexOf(watcher), 1);
            }

            privateWatchers = watchDirectories(this.seams, [join(folder, PROJECT_DIR, PRIVATE_DIR)], (filename) => {
                if (hearsFile(filename)) {
                    settle.nudge();
                }
            });
            watchers.push(...privateWatchers);

            return privateWatchers.length > 0;
        };

        // The private folder is made on a person's first private save, which may come after this watch began.
        watchPrivate();

        watchers.push(
            ...watchDirectories(this.seams, [join(folder, PROJECT_DIR)], (filename) => {
                if (filename === PRIVATE_DIR) {
                    // The file may be in the folder already by the time it is watched.
                    if (watchPrivate()) {
                        settle.nudge();
                    }
                } else if (hearsFile(filename)) {
                    settle.nudge();
                }
            })
        );

        this.watched.set(projectId, { folder, watchers, settle });
    }

    private forget(projectId: string): void {
        const watch = this.watched.get(projectId);

        for (const watcher of watch?.watchers ?? []) {
            watcher.close();
        }

        watch?.settle.stop();
        this.watched.delete(projectId);
    }
}
