import { join } from 'node:path';
import { settled, type Settled, type WatchSeams } from '@adecore/agents';
import { PRIVATE_DIR, PROJECT_DIR } from '@ruimte/contracts';
import { PROJECT_FILE, WATCH_SETTLE_MS, watchFolderChain, type FolderChain } from './project-files.ts';
import { ICON_INPUT_FOLDERS, isIconInput } from './project-identity.ts';

/* What changed: the shared or the private file, or a file the project's icon is derived from. */
export type FolderChange = 'files' | 'icon';

/* The chains of one project's icon folders, by the name of the folder at the top of each. */
interface IconWatch {
    folder: string;
    chains: Map<string, FolderChain>;
    settle: Settled;
}

interface Watched {
    folder: string;
    chain: FolderChain;
    settle: Settled;
    icons: IconWatch;
}

/* The folders that hold icon inputs as chains from the top of the project folder down; `.ruimte` is in the files' chain. */
function iconChains(): ReadonlyMap<string, readonly string[]> {
    const chains = new Map<string, string[]>();
    for (const path of ICON_INPUT_FOLDERS) {
        const top = path.split('/')[0]!;
        if (top !== PROJECT_DIR) {
            chains.set(top, [...(chains.get(top) ?? []), path]);
        }
    }

    return chains;
}

const ICON_CHAINS = iconChains();

/* Watches one folder at the top of the project folder that may hold an icon, and the folders under it that may too. */
function watchIconFolder(seams: WatchSeams, icons: IconWatch, top: string): void {
    const paths = ICON_CHAINS.get(top) ?? [];
    icons.chains.get(top)?.close();
    icons.chains.set(
        top,
        watchFolderChain(
            seams,
            paths.map((path) => join(icons.folder, path)),
            (depth, filename) => {
                if (filename === null || isIconInput(`${paths[depth]}/${filename}`)) {
                    icons.settle.nudge();
                }
            }
        )
    );
}

/*
 * Hears the shared and the private file of every project it is given change from outside the daemon, and the files
 * its icon comes from. A project a client holds has a watcher of its own for its files, so those are for the others,
 * whose edit no client would hear of.
 */
export class ProjectFolderWatch {
    private readonly seams: WatchSeams;
    private readonly changed: (projectId: string, change: FolderChange) => void;
    private readonly watched = new Map<string, Watched>();

    constructor(seams: WatchSeams, changed: (projectId: string, change: FolderChange) => void) {
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
            const watched = this.watched.get(projectId);
            if (watched === undefined) {
                this.watch(projectId, folder);
            } else if (watched.chain.retry()) {
                // A folder that was missing when the watch began is there now, with whatever it holds.
                for (const top of ICON_CHAINS.keys()) {
                    watchIconFolder(this.seams, watched.icons, top);
                }
                watched.settle.nudge();
                watched.icons.settle.nudge();
            }
        }
    }

    close(): void {
        for (const projectId of [...this.watched.keys()]) {
            this.forget(projectId);
        }
    }

    private watch(projectId: string, folder: string): void {
        const settle = settled(this.seams, WATCH_SETTLE_MS, () => this.changed(projectId, 'files'));
        const icons: IconWatch = { folder, chains: new Map(), settle: settled(this.seams, WATCH_SETTLE_MS, () => this.changed(projectId, 'icon')) };
        // The folder each depth of the chain holds, whose coming or going takes the files under it along.
        const below = [PROJECT_DIR, PRIVATE_DIR];

        const chain = watchFolderChain(this.seams, [folder, join(folder, PROJECT_DIR), join(folder, PROJECT_DIR, PRIVATE_DIR)], (depth, filename) => {
            if (filename === null || filename === below[depth] || (depth > 0 && filename === PROJECT_FILE)) {
                settle.nudge();
            }

            if (filename === null) {
                icons.settle.nudge();
            } else if (depth === 0 && ICON_CHAINS.has(filename)) {
                // A folder an icon may live in came or went, so it is watched anew.
                watchIconFolder(this.seams, icons, filename);
                icons.settle.nudge();
            } else if ((depth === 0 && isIconInput(filename)) || (depth === 1 && isIconInput(`${PROJECT_DIR}/${filename}`))) {
                icons.settle.nudge();
            }
        });

        for (const top of ICON_CHAINS.keys()) {
            watchIconFolder(this.seams, icons, top);
        }

        this.watched.set(projectId, { folder, chain, settle, icons });
    }

    private forget(projectId: string): void {
        const watch = this.watched.get(projectId);
        watch?.chain.close();
        for (const chain of watch?.icons.chains.values() ?? []) {
            chain.close();
        }
        watch?.settle.stop();
        watch?.icons.settle.stop();
        this.watched.delete(projectId);
    }
}
