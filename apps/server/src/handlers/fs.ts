import type { FsCreateResult } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import { browseDirectories } from '../fs/browse.ts';
import { planCreate } from '../fs/create.ts';
import { planDelete } from '../fs/delete.ts';
import { createEntry } from '../fs/create.ts';
import { listDirectory } from '../fs/list.ts';
import { locateFile } from '../fs/locate.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import type { FileMove, LanguageHost } from '../language/host.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import { readFile } from '../fs/read.ts';
import { planRename } from '../fs/rename.ts';
import { revealInFileManager } from '../fs/reveal.ts';
import { grepFiles } from '../fs/grep.ts';
import { listSearchableFiles, searchFiles } from '../fs/search.ts';
import type { FolderWatcher } from '../fs/watch.ts';
import { writeTextFile, type WriteBoundary } from '../fs/write.ts';

/* How the host writes and makes the files a server's edit touches, inside the boundary of the client that asked. */
function editsOf(boundary: WriteBoundary): Omit<FileMove, 'move'> {
    return {
        write: async (path, text) => {
            const read = await readFile(path);
            if (read.kind === 'text') {
                await writeTextFile(path, text, read.mtime, boundary);
            }
        },
        create: async (path, text) => {
            await createEntry({ path, kind: 'file', text }, boundary);
        },
        rename: async (from, to, overwrite) => {
            await (await planRename(from, to, boundary, { overwrite })).run();
        },
        delete: async (path) => {
            await (await planDelete(path, boundary)).run();
        }
    };
}

export function registerFsHandlers(
    dispatcher: Dispatcher,
    watcher: FolderWatcher,
    boundaryOf: (clientId: string) => Promise<WriteBoundary>,
    machineHome: MachineHome,
    language?: Pick<LanguageHost, 'renameFiles' | 'createFiles' | 'deleteFiles'>
): void {
    dispatcher.register('fs.browse', (payload) => browseDirectories(payload.partialPath, payload.cwd, { hidden: payload.hidden }));

    dispatcher.register('fs.search', async (payload) => {
        await machineHome.refuse(payload.cwd);
        return searchFiles(payload.cwd, payload.query, payload.limit, await machineHome.policy());
    });

    dispatcher.register('fs.grep', async (payload) => {
        await machineHome.refuse(payload.cwd);
        return grepFiles(payload.cwd, payload.query, {
            regex: payload.regex,
            caseSensitive: payload.caseSensitive,
            wholeWord: payload.wholeWord,
            limit: payload.limit,
            policy: await machineHome.policy()
        });
    });

    dispatcher.register('fs.locate', async (payload) => {
        await machineHome.refuse(payload.cwd);
        return locateFile(payload, {
            repos: (folder) => cachedRepos(folder),
            policy: await machineHome.policy(),
            list: async (folder) => (await listSearchableFiles(folder)).files
        });
    });

    dispatcher.register('fs.list', (payload) => listDirectory(payload.path, { depth: payload.depth, hidden: payload.hidden }));

    dispatcher.register('fs.read', async (payload) => {
        await machineHome.refuse(payload.path);
        return readFile(payload.path);
    });

    dispatcher.register('fs.write', async (payload, client) => {
        await machineHome.refuse(payload.path);
        return writeTextFile(payload.path, payload.text, payload.expectedMtime, await boundaryOf(client.id));
    });

    dispatcher.register('fs.create', async (payload, client) => {
        await machineHome.refuse(payload.path);
        const boundary = await boundaryOf(client.id);
        const plan = await planCreate(payload, boundary);
        if (payload.projectId === undefined || language === undefined) {
            return plan.run();
        }
        let made: FsCreateResult | undefined;
        const edited = await language.createFiles(client.id, payload.projectId, payload.path, payload.kind === 'directory', payload.edits !== false, {
            ...editsOf(boundary),
            move: async () => {
                made = await plan.run();
            }
        });
        return edited.length > 0 ? { ...made!, edited } : made!;
    });

    dispatcher.register('fs.delete', async (payload, client) => {
        await machineHome.refuse(payload.path);
        const boundary = await boundaryOf(client.id);
        const plan = await planDelete(payload.path, boundary);
        if (payload.projectId === undefined || language === undefined) {
            await plan.run();
            return {};
        }
        const edited = await language.deleteFiles(client.id, payload.projectId, payload.path, payload.edits !== false, {
            ...editsOf(boundary),
            move: plan.run
        });
        return edited.length > 0 ? { edited } : {};
    });

    dispatcher.register('fs.rename', async (payload, client) => {
        await Promise.all([machineHome.refuse(payload.path), machineHome.refuse(payload.to)]);
        const boundary = await boundaryOf(client.id);
        const plan = await planRename(payload.path, payload.to, boundary, { overwrite: payload.overwrite });
        if (payload.projectId === undefined || language === undefined) {
            await plan.run();
            return {};
        }
        const edited = await language.renameFiles(client.id, payload.projectId, payload.path, payload.to, payload.edits !== false, {
            ...editsOf(boundary),
            move: plan.run
        });
        return edited.length > 0 ? { edited } : {};
    });

    dispatcher.register('fs.watch', async (payload, client) => {
        await watcher.watch(client.id, payload.path);
        return {};
    });

    dispatcher.register('fs.unwatch', (payload, client) => {
        watcher.unwatch(client.id, payload.path);
        return {};
    });

    dispatcher.register('fs.reveal', async (payload) => {
        await revealInFileManager(payload.path);
        return {};
    });
}
