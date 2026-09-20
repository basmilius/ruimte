import { translate, type Dispatcher } from '../dispatcher.ts';
import type { SessionManager } from '../sessions/manager.ts';

/* Owes ending the agents a session's node opened, before that session goes; a shell that already exited ends nothing, so a restart does not. */
export type BeforeKill = (nodeId: string) => Promise<unknown>;

export const registerSessionHandlers = (dispatcher: Dispatcher, manager: SessionManager, beforeKill?: BeforeKill): void => {
    dispatcher.register('session.create', (payload) => translate(() => manager.create(payload)));

    dispatcher.register('session.attach', (payload, client) =>
        translate(() => manager.attach(payload.sessionId, client.id, payload.follow ? undefined : payload.cols, payload.follow ? undefined : payload.rows))
    );

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
            if (manager.get(payload.sessionId)?.exited === false) {
                await beforeKill?.(payload.sessionId);
            }
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

    // Answering a request that is already settled is not an error. A second client is simply late.
    dispatcher.register('agent.answerApproval', (payload) => ({
        accepted: manager.answerApproval(payload.sessionId, payload.requestId, payload.choiceId)
    }));

    // A client that will not show a permission request says so, and this daemon stops holding one for it.
    dispatcher.register('agent.setApprovals', (payload, client) => {
        manager.setApprovalPreference(client.id, payload.enabled);
        return {};
    });
};
