import { BrowserError, type BrowserManager } from '../browser/manager.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((error: unknown) => {
            if (error instanceof BrowserError) {
                throw new RequestError(error.code, error.message);
            }
            throw error;
        });

export const registerBrowserHandlers = (dispatcher: Dispatcher, browsers: BrowserManager): void => {
    dispatcher.register('browser.open', (payload, client) =>
        translate(() => browsers.open(payload.browserId, client.id, payload.url, payload.width, payload.height))
    );
    dispatcher.register('browser.detach', (payload, client) => {
        browsers.detach(payload.browserId, client.id);
        return {};
    });
    dispatcher.register('browser.kill', (payload) => {
        browsers.kill(payload.browserId);
        return {};
    });
    dispatcher.register('browser.navigate', (payload) => translate(() => browsers.navigate(payload.browserId, payload.url)));
    dispatcher.register('browser.command', (payload) => translate(() => browsers.command(payload.browserId, payload.command, payload.ignoreCache)));
    dispatcher.register('browser.resize', (payload) =>
        translate(async () => {
            await browsers.resize(payload.browserId, payload.width, payload.height);
            return {};
        })
    );
    dispatcher.register('browser.input', (payload) =>
        translate(async () => {
            await browsers.input(payload.browserId, payload.input);
            return {};
        })
    );
};
