import { FS_WRITE_MAX_BYTES, type FsCreateResult } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import { bestEffort } from '../best-effort.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { browseDirectories, browseTarget } from '../fs/browse.ts';
import { createEntry, planCreate } from '../fs/create.ts';
import { planDelete } from '../fs/delete.ts';
import { grepFiles } from '../fs/grep.ts';
import { listDirectory } from '../fs/list.ts';
import { locateFile } from '../fs/locate.ts';
import { readFile } from '../fs/read.ts';
import { planRename } from '../fs/rename.ts';
import { revealInFileManager } from '../fs/reveal.ts';
import { listSearchableFiles, searchFiles } from '../fs/search.ts';
import { TextUploads } from '../fs/text-uploads.ts';
import type { FolderWatcher } from '../fs/watch.ts';
import { refuseOutside } from '../fs/within.ts';
import { narrowTo, writeTextFile, type WriteBoundary } from '../fs/write.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import type { FileMove, LanguageHost } from '../language/host.ts';

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

export interface FsDeps {
    watcher: FolderWatcher;
    boundaryOf(clientId: string): Promise<WriteBoundary>;
    machineHome: Pick<MachineHome, 'refuse' | 'policy'>;
    language: Pick<LanguageHost, 'renameFiles' | 'createFiles' | 'deleteFiles' | 'saved'>;
}

export function fsArea(deps: FsDeps): Area {
    const { watcher } = deps;

    return { name: 'fs', sources: [watcher], holders: [watcher], handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { watcher, boundaryOf, machineHome, language }: FsDeps): void {
    dispatcher.register('fs.browse', async (payload) => {
        if (payload.cwd) {
            await machineHome.refuse(payload.cwd);
        }

        await machineHome.refuse(browseTarget(payload.partialPath, payload.cwd).parentPath);

        return browseDirectories(payload.partialPath, payload.cwd, { hidden: payload.hidden });
    });

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

    dispatcher.register('fs.list', async (payload) => {
        await machineHome.refuse(payload.path);
        await refuseOutside(payload.path, payload.within);

        return listDirectory(payload.path, { depth: payload.depth, hidden: payload.hidden, policy: await machineHome.policy() });
    });

    dispatcher.register(
        'fs.read',
        async (payload) => {
            await machineHome.refuse(payload.path);
            await refuseOutside(payload.path, payload.within);
            return readFile(payload.path);
        },
        { count: (payload) => [{ counter: 'files.opened', once: payload.path }] }
    );

    dispatcher.register(
        'fs.write',
        async (payload, client) => {
            await machineHome.refuse(payload.path);
            const boundary = await narrowTo(await boundaryOf(client.id), payload.within);
            const written = await writeTextFile(payload.path, payload.text, payload.expectedMtime, boundary);

            void bestEffort('language.saved', language.saved(payload.path, payload.text));

            return written;
        },
        { count: ['files.saved'] }
    );

    const uploads = new TextUploads();

    dispatcher.register('fs.writeStart', async (payload, client) => {
        await machineHome.refuse(payload.path);

        return { uploadId: uploads.start(client.id, payload.path, payload.size, payload.expectedMtime) };
    });

    dispatcher.register('fs.writePiece', (payload, client) => {
        uploads.piece(client.id, payload.uploadId, payload.offset, payload.data);

        return {};
    });

    dispatcher.register(
        'fs.writeCommit',
        async (payload, client) => {
            const { path, text, expectedMtime } = uploads.finish(client.id, payload.uploadId);

            await machineHome.refuse(path);

            const written = await writeTextFile(path, text, expectedMtime, await boundaryOf(client.id), FS_WRITE_MAX_BYTES);

            void bestEffort('language.saved', language.saved(path, text));

            return written;
        },
        { count: ['files.saved'] }
    );

    dispatcher.register('fs.writeAbort', (payload, client) => {
        uploads.abort(client.id, payload.uploadId);

        return {};
    });

    dispatcher.register('fs.create', async (payload, client) => {
        await machineHome.refuse(payload.path);
        const boundary = await narrowTo(await boundaryOf(client.id), payload.within);
        const plan = await planCreate(payload, boundary);
        if (payload.projectId === undefined) {
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
        if (payload.projectId === undefined) {
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
        if (payload.projectId === undefined) {
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
        await machineHome.refuse(payload.path);
        await watcher.watch(client.id, payload.path, await machineHome.policy());

        // The socket may have closed while the path was judged, and its cleanup ran before this watch existed.
        if (client.closed) {
            watcher.detachAll(client.id);
        }

        return {};
    });

    dispatcher.register('fs.unwatch', (payload, client) => {
        watcher.unwatch(client.id, payload.path);
        return {};
    });

    dispatcher.register('fs.reveal', async (payload) => {
        await machineHome.refuse(payload.path);
        await revealInFileManager(payload.path);
        return {};
    });
}
