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

    dispatcher.register('session.runHeld', (payload) =>
        translate(async () => {
            await manager.runHeld(payload.sessionId);
            return {};
        })
    );

    dispatcher.register('session.list', () => ({ sessions: manager.list() }));

    dispatcher.register('agent.resume', (payload) =>
        translate(async () => {
            await manager.resumeAgent(payload.sessionId);
            return {};
        })
    );

    // A terminal's permission request is answered in its CLI's own prompt; these two stay for clients built before that.
    dispatcher.register('agent.answerApproval', () => ({ accepted: false }));
    dispatcher.register('agent.setApprovals', () => ({}));
};
