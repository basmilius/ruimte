import { translate, type Dispatcher } from '../dispatcher.ts';
import { browseDirectories } from '../fs/browse.ts';
import { listDirectory } from '../fs/list.ts';
import { readFile } from '../fs/read.ts';
import { revealInFileManager } from '../fs/reveal.ts';
import { grepFiles } from '../fs/grep.ts';
import { searchFiles } from '../fs/search.ts';
import type { FolderWatcher } from '../fs/watch.ts';
import { writeTextFile, type WriteBoundary } from '../fs/write.ts';

export const registerFsHandlers = (dispatcher: Dispatcher, watcher: FolderWatcher, boundaryOf: (clientId: string) => Promise<WriteBoundary>): void => {
    dispatcher.register('fs.browse', (payload) => translate(() => browseDirectories(payload.partialPath, payload.cwd, { hidden: payload.hidden })));

    dispatcher.register('fs.search', (payload) => searchFiles(payload.cwd, payload.query, payload.limit));

    dispatcher.register('fs.grep', (payload) =>
        translate(() =>
            grepFiles(payload.cwd, payload.query, {
                regex: payload.regex,
                caseSensitive: payload.caseSensitive,
                wholeWord: payload.wholeWord,
                limit: payload.limit
            })
        )
    );

    dispatcher.register('fs.list', (payload) => translate(() => listDirectory(payload.path, { depth: payload.depth, hidden: payload.hidden })));

    dispatcher.register('fs.read', (payload) => translate(() => readFile(payload.path)));

    dispatcher.register('fs.write', (payload, client) =>
        translate(async () => writeTextFile(payload.path, payload.text, payload.expectedMtime, await boundaryOf(client.id)))
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
};
