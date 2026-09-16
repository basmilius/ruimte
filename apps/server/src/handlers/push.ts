import type { AuthStore } from '../auth/auth-store.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';

export const registerPushHandlers = (dispatcher: Dispatcher, auth: AuthStore, changed: () => void = () => undefined): void => {
    dispatcher.register('push.subscribe', async (payload, client) => {
        const sessionId = client.access?.sessionId;
        if (!sessionId || !(await auth.setPush(sessionId, payload))) {
            throw new RequestError('unauthorized', 'Push requires a paired client key');
        }
        changed();
        return {};
    });
    dispatcher.register('push.unsubscribe', async (payload, client) => {
        const sessionId = client.access?.sessionId;
        if (!sessionId) {
            throw new RequestError('unauthorized', 'Push requires a paired client key');
        }
        await auth.removePush(sessionId, payload.handle);
        changed();
        return {};
    });
};
