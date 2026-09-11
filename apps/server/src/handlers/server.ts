import type { Dispatcher } from '../dispatcher.ts';

interface ServerHandlerOptions {
    version: string;
    home: string;
    /* What this machine's hardware is called, or null when nothing here could say. */
    model: string | null;
}

export const registerServerHandlers = (dispatcher: Dispatcher, options: ServerHandlerOptions): void => {
    dispatcher.register('server.hello', () => ({
        version: options.version,
        platform: process.platform,
        home: options.home,
        ...(options.model === null ? {} : { model: options.model })
    }));

    // Nothing to compute: the round trip is the answer, and the client times it.
    dispatcher.register('server.ping', () => ({ time: Date.now() }));
};
