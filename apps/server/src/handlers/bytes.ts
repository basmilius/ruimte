import { BytesError, readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';

export const registerBytesHandlers = (dispatcher: Dispatcher, sources: ByteSources): void => {
    dispatcher.register('bytes.read', (payload) =>
        readBytes(sources, payload).catch((e: unknown) => {
            if (e instanceof BytesError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        })
    );
};
