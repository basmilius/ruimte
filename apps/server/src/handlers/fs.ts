import { translate, type Dispatcher } from '../dispatcher.ts';
import { browseDirectories } from '../fs/browse.ts';
import { createEntry } from '../fs/create.ts';
import { deletePath } from '../fs/delete.ts';
import { listDirectory } from '../fs/list.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import { readFile } from '../fs/read.ts';
import { revealInFileManager } from '../fs/reveal.ts';
import { grepFiles } from '../fs/grep.ts';
import { searchFiles } from '../fs/search.ts';
import type { FolderWatcher } from '../fs/watch.ts';
import { writeTextFile, type WriteBoundary } from '../fs/write.ts';

export function registerFsHandlers(
    dispatcher: Dispatcher,
    watcher: FolderWatcher,
    boundaryOf: (clientId: string) => Promise<WriteBoundary>,
    machineHome: MachineHome
): void {
    dispatcher.register('fs.browse', (payload) => translate(() => browseDirectories(payload.partialPath, payload.cwd, { hidden: payload.hidden })));

    dispatcher.register('fs.search', (payload) => searchFiles(payload.cwd, payload.query, payload.limit));

    dispatcher.register('fs.grep', (payload) =>
        translate(async () => {
            await machineHome.refuse(payload.cwd);
            return grepFiles(payload.cwd, payload.query, {
                regex: payload.regex,
                caseSensitive: payload.caseSensitive,
                wholeWord: payload.wholeWord,
                limit: payload.limit
            });
        })
    );

    dispatcher.register('fs.list', (payload) => translate(() => listDirectory(payload.path, { depth: payload.depth, hidden: payload.hidden })));

    dispatcher.register('fs.read', (payload) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            return readFile(payload.path);
        })
    );

    dispatcher.register('fs.write', (payload, client) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            return writeTextFile(payload.path, payload.text, payload.expectedMtime, await boundaryOf(client.id));
        })
    );

    dispatcher.register('fs.create', (payload, client) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            return createEntry(payload, await boundaryOf(client.id));
        })
    );

    dispatcher.register('fs.delete', (payload, client) =>
        translate(async () => {
            await machineHome.refuse(payload.path);
            await deletePath(payload.path, await boundaryOf(client.id));
            return {};
        })
    );

    dispatcher.register('fs.watch', async (payload, client) => {
        await watcher.watch(client.id, payload.path);
        return {};
    });

    dispatcher.register('fs.unwatch', (payload, client) => {
        watcher.unwatch(client.id, payload.path);
        return {};
    });

    dispatcher.register('fs.reveal', (payload) =>
        translate(async () => {
            await revealInFileManager(payload.path);
            return {};
        })
    );
}
