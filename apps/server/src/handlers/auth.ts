import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { AuthStore } from '../auth/auth-store.ts';

export interface EndpointIdentity {
    label: string;
    version: string;
}

export const registerAuthHandlers = (dispatcher: Dispatcher, store: AuthStore, identity: EndpointIdentity): void => {
    dispatcher.register('endpoint.info', (_payload, client) => ({
        label: identity.label,
        platform: process.platform,
        version: identity.version,
        reachability: client.access?.reachability ?? 'loopback',
        authenticated: client.access?.sessionId !== null && client.access?.sessionId !== undefined
    }));

    dispatcher.register('auth.sessions', async (_payload, client) => ({ sessions: await store.list(client.access?.sessionId ?? null) }));

    dispatcher.register('auth.revoke', async (payload) => {
        if (!(await store.revoke(payload.id))) {
            throw new RequestError('session-not-found', `No paired client ${payload.id}`);
        }
        return {};
    });
};
