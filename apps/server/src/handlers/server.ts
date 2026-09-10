import type { Dispatcher } from '../dispatcher.ts';

interface ServerHandlerOptions {
    version: string;
    home: string;
}

export const registerServerHandlers = (dispatcher: Dispatcher, options: ServerHandlerOptions): void => {
    dispatcher.register('server.hello', () => ({
        version: options.version,
        platform: process.platform,
        home: options.home
    }));

    // Nothing to compute: the round trip is the answer, and the client times it.
    dispatcher.register('server.ping', () => ({ time: Date.now() }));
};
