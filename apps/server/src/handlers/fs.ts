import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { BrowseError, browseDirectories } from '../fs/browse.ts';
import { ListError, listDirectory } from '../fs/list.ts';
import { RevealError, revealInFileManager } from '../fs/reveal.ts';
import { searchFiles } from '../fs/search.ts';
import type { FolderWatcher } from '../fs/watch.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof BrowseError || e instanceof ListError || e instanceof RevealError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerFsHandlers = (dispatcher: Dispatcher, watcher: FolderWatcher): void => {
    dispatcher.register('fs.browse', (payload) => translate(() => browseDirectories(payload.partialPath, payload.cwd)));

    dispatcher.register('fs.search', (payload) => searchFiles(payload.cwd, payload.query, payload.limit));

    dispatcher.register('fs.list', (payload) => translate(() => listDirectory(payload.path, { depth: payload.depth, hidden: payload.hidden })));

    dispatcher.register('fs.watch', (payload, client) => {
        watcher.watch(client.id, payload.path);
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
