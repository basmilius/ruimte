import type { Dispatcher } from '../dispatcher.ts';

export interface ServerHandlerOptions {
    version: string;
    home: string;
}

export const registerServerHandlers = (dispatcher: Dispatcher, options: ServerHandlerOptions): void => {
    dispatcher.register('server.hello', () => ({
        version: options.version,
        platform: process.platform,
        home: options.home
    }));
};
