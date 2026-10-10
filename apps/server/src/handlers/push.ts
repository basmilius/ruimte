import { PUSH_NOTIFY_DEFAULT } from '@ruimte/contracts';
import type { PushService } from '../push/service.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { RequestError, type ClientConnection, type Dispatcher } from '../dispatcher.ts';

function provenSession(client: ClientConnection): string {
    const sessionId = client.access?.sessionId;
    if (!sessionId) {
        throw new RequestError('unauthorized', 'Push needs a client that proved its key to this machine');
    }
    return sessionId;
}

export function registerPushHandlers(dispatcher: Dispatcher, auth: AuthStore, changed: () => void = () => undefined, push?: PushService): void {
    dispatcher.register('push.attention', () => ({ entries: push?.attention.snapshot() ?? [], ...(push ? { marksFrom: push.attention.marksFrom } : {}) }));
    dispatcher.register('push.read', ({ nodeId, issuedAt }) => {
        push?.read(nodeId, issuedAt);
        return {};
    });
    dispatcher.register('push.subscribe', async (payload, client) => {
        if (!(await auth.setPush(provenSession(client), payload))) {
            throw new RequestError('unauthorized', 'Push needs a client that proved its key to this machine');
        }
        changed();
        return {};
    });
    dispatcher.register('push.preferences', async (_payload, client) => {
        const sessionId = provenSession(client);
        const subscription = (await auth.pushSubscriptions()).find((entry) => entry.sessionId === sessionId)?.subscription;
        return {
            subscribed: subscription !== undefined,
            approvals: subscription?.approvals ?? false,
            notify: subscription?.notify ?? [...PUSH_NOTIFY_DEFAULT],
            projects: subscription?.projects ?? []
        };
    });
    dispatcher.register('push.unsubscribe', async (payload, client) => {
        await auth.removePush(provenSession(client), payload.handle);
        changed();
        return {};
    });
}
