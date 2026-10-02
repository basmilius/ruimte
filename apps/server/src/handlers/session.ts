import type { AgentKind } from '@ruimte/contracts';
import { translate, type Dispatcher } from '../dispatcher.ts';
import { SessionError, type SessionManager } from '../sessions/manager.ts';

/* Owes ending the agents a session's node opened, before that session goes; a shell that already exited ends nothing, so a restart does not. */
export type BeforeKill = (nodeId: string) => Promise<unknown>;

/* The CLIs as a login names them: the CLI's own login command, if it has one, and its name. */
export interface LoginCommands {
    commandOf(kind: AgentKind): string | undefined;
    nameOf(kind: AgentKind): string;
}

export const registerSessionHandlers = (dispatcher: Dispatcher, manager: SessionManager, beforeKill?: BeforeKill, logins?: LoginCommands): void => {
    dispatcher.register('session.create', (payload) => translate(() => manager.create(payload)));

    /* No `cwd`, so the shell starts in the home folder. The default account is named outright, since a
       launch without one would take the person's pick for new agents instead. */
    dispatcher.register('session.login', (payload, client) =>
        translate(async () => {
            const command = logins?.commandOf(payload.kind);
            if (logins === undefined || command === undefined) {
                throw new SessionError('login-unavailable', `${logins?.nameOf(payload.kind) ?? payload.kind} has no login of its own`);
            }
            const created = await manager.create({
                sessionId: payload.sessionId,
                cols: payload.cols,
                rows: payload.rows,
                command,
                agent: { kind: payload.kind, account: payload.account ?? payload.kind },
                fresh: true,
                forClient: { clientId: client.id, label: `${logins.nameOf(payload.kind)} login` }
            });
            // The login lives for its client, whose leaving ended the others before this one was there.
            if (client.closed) {
                await manager.kill(created.sessionId);
            }
            return created;
        })
    );

    dispatcher.register('session.attach', (payload, client) =>
        translate(() => manager.attach(payload.sessionId, client.id, payload.follow ? undefined : payload.cols, payload.follow ? undefined : payload.rows))
    );

    dispatcher.register('session.detach', (payload, client) =>
        translate(() => {
            manager.detach(payload.sessionId, client.id);
            return {};
        })
    );

    dispatcher.register('session.write', (payload, client) =>
        translate(() => {
            manager.write(payload.sessionId, payload.data, client.id);
            return {};
        })
    );

    dispatcher.register('session.resize', (payload, client) =>
        translate(() => {
            manager.resize(payload.sessionId, payload.cols, payload.rows, client.id);
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
