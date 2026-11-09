import { CodedError } from '@adecore/agents';
import { PUSH_NOTIFY_DEFAULT } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { type Dispatcher } from '../dispatcher.ts';
import type { PushService } from '../push/service.ts';
import { sendEvent, type ClientConnection } from '../wire.ts';

function provenSession(client: ClientConnection): string {
    const sessionId = client.access?.sessionId;
    if (!sessionId) {
        throw new CodedError('unauthorized', 'Push needs a client that proved its key to this machine');
    }
    return sessionId;
}

interface PushDeps {
    auth: AuthStore;
    push: PushService;
    /* A subscription was added or removed, so the activities the machine keeps for phones follow. */
    changed(): void;
}

export function pushArea(deps: PushDeps): Area {
    const { push } = deps;

    return {
        name: 'push',
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        connect: ({ client, access }) => [
            push.connected(access.sessionId),
            () => push.reportPresence(client.id, false),
            push.observeAttention((entry) => sendEvent(client, 'push.attention', entry)),
            push.observeNotification((alert) => sendEvent(client, 'push.notification', alert))
        ]
    };
}

function registerRequests(dispatcher: Dispatcher, { auth, push, changed }: PushDeps): void {
    dispatcher.register('push.attention', () => ({ entries: push.marks(), marksFrom: push.attention.marksFrom }));
    dispatcher.register('push.read', ({ nodeId, issuedAt }) => {
        push.read(nodeId, issuedAt);
        return {};
    });
    dispatcher.register('presence.report', ({ present }, client) => {
        push.reportPresence(client.id, present);
        return {};
    });
    dispatcher.register('push.subscribe', async (payload, client) => {
        if (!(await auth.setPush(provenSession(client), payload))) {
            throw new CodedError('unauthorized', 'Push needs a client that proved its key to this machine');
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
            projects: subscription?.projects ?? [],
            ...(subscription?.quietHours ? { quietHours: subscription.quietHours } : {})
        };
    });
    dispatcher.register('push.unsubscribe', async (payload, client) => {
        await auth.removePush(provenSession(client), payload.handle);
        changed();
        return {};
    });
}
