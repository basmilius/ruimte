import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { BrowseError, browseDirectories } from '../fs/browse.ts';
import { RevealError, revealInFileManager } from '../fs/reveal.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof BrowseError || e instanceof RevealError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerFsHandlers = (dispatcher: Dispatcher): void => {
    dispatcher.register('fs.browse', (payload) => translate(() => browseDirectories(payload.partialPath, payload.cwd)));

    dispatcher.register('fs.reveal', (payload) =>
        translate(async () => {
            await revealInFileManager(payload.path);
            return {};
        })
    );
};
