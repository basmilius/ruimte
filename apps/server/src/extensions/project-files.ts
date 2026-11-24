import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isWithin } from '@adecore/utils/path';
import { extensionProjectPath } from '@ruimte/contracts';
import type { MachineHome } from '../disk/machine-home.ts';
import { listDirectory } from '../fs/list.ts';
import { readFile } from '../fs/read.ts';
import type { FolderWatcher } from '../fs/watch.ts';
import { refuseOutside } from '../fs/within.ts';
import type { ExtensionFilesPort } from './extension-host.ts';
import { ExtensionRefusal } from './refusal.ts';

interface ProjectFilesDeps {
    folderOf(projectId: string): string | null;
    machineHome: Pick<MachineHome, 'refuse' | 'policy'>;
    watcher: Pick<FolderWatcher, 'subscribe' | 'watch' | 'detachAll'>;
}

/* The watcher keeps its watches per client; each watch of an extension is one of its own, so letting go of one leaves the rest. */
function watchClient(extensionId: string, watch: number): string {
    return `extension:${extensionId}:${watch}`;
}

/*
 * The files of a project as an extension's `server/` reads them: only inside the project folder, past every symlink,
 * and never the machine's own state, by the rules a client's `fs.read` is held to.
 */
export function extensionProjectFiles({ folderOf, machineHome, watcher }: ProjectFilesDeps): ExtensionFilesPort {
    const stops = new Map<string, () => void>();

    const placed = async (projectId: string, path: string): Promise<string> => {
        const folder = folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        const full = extensionProjectPath(folder, path);

        if (full === null) {
            throw new ExtensionRefusal('outside-project', `${path} is outside the project folder`);
        }

        await machineHome.refuse(full);
        await refuseOutside(full, folder);

        return full;
    };

    const unwatch = (clientId: string): void => {
        stops.get(clientId)?.();
        stops.delete(clientId);
    };

    return {
        async readText(projectId, path) {
            const read = await readFile(await placed(projectId, path));

            if (read.kind !== 'text') {
                throw new ExtensionRefusal('refused', `${path} is not a text file`);
            }

            return read.text;
        },
        async list(projectId, folder) {
            const { entries } = await listDirectory(await placed(projectId, folder), { policy: await machineHome.policy() });

            return entries.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind }));
        },
        async watch(extensionId, watch, projectId, path, changed) {
            const full = await placed(projectId, path);
            const folder = await stat(full).then(
                (found) => found.isDirectory(),
                () => false
            );
            const clientId = watchClient(extensionId, watch);

            unwatch(clientId);

            const unsubscribe = watcher.subscribe(clientId, (event) => {
                if (event.event !== 'fs.changed') {
                    return;
                }

                const { changedPaths } = event.payload;

                // A burst that names no files may have touched this one too.
                if (changedPaths === undefined || changedPaths.some((touched) => touched === full || (folder && isWithin(full, touched)))) {
                    changed();
                }
            });

            stops.set(clientId, () => {
                unsubscribe();
                watcher.detachAll(clientId);
            });
            // A file is followed through its folder: a save that swaps the file in would leave a watch of the file itself behind.
            await watcher.watch(clientId, folder ? full : dirname(full), await machineHome.policy());
        },
        unwatch: (extensionId, watch) => unwatch(watchClient(extensionId, watch)),
        unwatchAll(extensionId) {
            for (const clientId of [...stops.keys()]) {
                if (clientId.startsWith(`extension:${extensionId}:`)) {
                    unwatch(clientId);
                }
            }
        }
    };
}
