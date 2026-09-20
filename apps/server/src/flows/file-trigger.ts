import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { textArg } from '@ruimte/flow';
import { settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '../fs/watch-seam.ts';
import type { FlowRunner } from './runner.ts';

// A save, a formatter and a build all touch a folder in a burst; one round per burst is enough.
const SETTLE_MS = 250;

/* What never fires a flow: the repository's own bookkeeping and Ruimte's, which a flow itself writes. */
const IGNORED = ['.git', '.ruimte', 'node_modules'];

/* The most text a changed file hands the flow as a token; the rest is a file, not a value. */
const MOST_CONTENT = 64 * 1024;

export interface FlowFileWatcherDeps {
    runner: FlowRunner;
    /* The folder of a project, or null for one that has none. */
    folderOf(projectId: string): Promise<string | null>;
    seams?: WatchSeams;
    platform?: NodeJS.Platform;
}

interface Watch {
    folder: string;
    watcher: DirectoryWatcher;
    touched: Set<string>;
    settle: Settled;
}

/*
 * The one watcher behind every "a file changed" card that is turned on, a folder at a time. Nothing
 * is watched while no flow asks for it: a watch on a large repository is not free, and a flow nobody
 * turned on has no business making the daemon listen.
 */
export class FlowFileWatcher {
    private readonly deps: FlowFileWatcherDeps;
    private readonly seams: WatchSeams;
    private readonly platform: NodeJS.Platform;
    private readonly watches = new Map<string, Watch>();

    constructor(deps: FlowFileWatcherDeps) {
        this.deps = deps;
        this.seams = deps.seams ?? SYSTEM_WATCH;
        this.platform = deps.platform ?? process.platform;
    }

    /* Starts watching the folders that now have a listening flow, and stops the ones that do not. */
    async refresh(): Promise<void> {
        const listening = await this.deps.runner.listening('files.changed');
        const folders = new Set<string>();
        for (const flow of listening) {
            const folder = await this.deps.folderOf(flow.projectId);
            if (folder !== null) {
                folders.add(resolve(folder));
            }
        }
        for (const [folder, watch] of this.watches) {
            if (!folders.has(folder)) {
                watch.settle.stop();
                watch.watcher.close();
                this.watches.delete(folder);
            }
        }
        for (const folder of folders) {
            this.start(folder);
        }
    }

    stop(): void {
        for (const [folder, watch] of this.watches) {
            watch.settle.stop();
            watch.watcher.close();
            this.watches.delete(folder);
        }
    }

    /* A path under a watched folder changed. The watcher calls this; a test calls it straight. */
    async touched(folder: string, paths: readonly string[]): Promise<void> {
        const wanted = paths.map((path) => path.split(sep).join('/')).filter((path) => path !== '' && !IGNORED.includes(path.split('/')[0] as string));
        if (wanted.length === 0) {
            return;
        }
        for (const flow of await this.deps.runner.listening('files.changed')) {
            const flowFolder = await this.deps.folderOf(flow.projectId);
            if (flowFolder === null || resolve(flowFolder) !== resolve(folder)) {
                continue;
            }
            for (const [cardId, card] of flow.cards) {
                const wants = textArg(card, 'path').split(sep).join('/').replace(/^\.\//, '');
                const hit = wanted.find((path) => path === wants || path.startsWith(`${wants}/`));
                if (hit === undefined) {
                    continue;
                }
                await this.deps.runner.fire(flow.projectId, flow.viewId, {
                    cardId,
                    tokens: { [`${cardId}.path`]: hit, [`${cardId}.content`]: await contentOf(resolve(folder, hit)) }
                });
            }
        }
    }

    private start(folder: string): void {
        if (this.watches.has(folder)) {
            return;
        }
        let watcher: DirectoryWatcher;
        try {
            watcher = this.seams.watch(folder, { recursive: supportsRecursive(this.platform) }, (_event, filename) => {
                if (typeof filename === 'string') {
                    watch.touched.add(filename);
                    watch.settle.nudge();
                }
            });
        } catch {
            // A folder that cannot be watched leaves its flows waiting rather than taking the daemon down.
            return;
        }
        const watch: Watch = {
            folder,
            watcher,
            touched: new Set(),
            settle: settled(this.seams, SETTLE_MS, async () => {
                const paths = [...watch.touched];
                watch.touched.clear();
                await this.touched(folder, paths);
            })
        };
        watcher.on('error', () => undefined);
        this.watches.set(folder, watch);
    }
}

/* What a changed file hands on as a token: its text, or nothing for something that is not text. */
const contentOf = async (path: string): Promise<string> => {
    const text = await readFile(path, 'utf8').catch(() => '');
    return text.length > MOST_CONTENT ? text.slice(0, MOST_CONTENT) : text;
};

/* The path of a change as the watcher reports it, relative to the folder it watches. */
export const relativeTouch = (folder: string, path: string): string => relative(resolve(folder), resolve(path));
