import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { SessionError, type SessionManager } from '../sessions/manager.ts';

// Session failures carry their own codes; anything else stays an internal error for the dispatcher to report.
const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof SessionError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerSessionHandlers = (dispatcher: Dispatcher, manager: SessionManager): void => {
    dispatcher.register('session.create', (payload) => translate(() => manager.create(payload)));

    dispatcher.register('session.attach', (payload, client) => translate(() => manager.attach(payload.sessionId, client.id, payload.cols, payload.rows)));

    dispatcher.register('session.detach', (payload, client) =>
        translate(() => {
            manager.detach(payload.sessionId, client.id);
            return {};
        })
    );

    dispatcher.register('session.write', (payload) =>
        translate(() => {
            manager.write(payload.sessionId, payload.data);
            return {};
        })
    );

    dispatcher.register('session.resize', (payload) =>
        translate(() => {
            manager.resize(payload.sessionId, payload.cols, payload.rows);
            return {};
        })
    );

    dispatcher.register('session.kill', (payload) =>
        translate(async () => {
            await manager.kill(payload.sessionId);
            return {};
        })
    );

    dispatcher.register('session.clear', (payload) =>
        translate(async () => {
            await manager.clear(payload.sessionId);
            return {};
        })
    );

    dispatcher.register('session.list', () => ({ sessions: manager.list() }));

    dispatcher.register('agent.resume', (payload) =>
        translate(() => {
            manager.resumeAgent(payload.sessionId);
            return {};
        })
    );
};
