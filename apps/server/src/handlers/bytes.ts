import { readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import { translate, type Dispatcher } from '../dispatcher.ts';

export const registerBytesHandlers = (dispatcher: Dispatcher, sources: ByteSources): void => {
    dispatcher.register('bytes.read', (payload) => translate(() => readBytes(sources, payload)));
};
