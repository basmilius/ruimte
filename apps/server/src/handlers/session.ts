import type { AgentKind } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import { refuseBoundNode, type MachineOfNode } from '../remote/bound-nodes.ts';
import { SessionError, type SessionManager } from '../sessions/manager.ts';
import { recordTiming } from '../stats/usage-stats.ts';

/* Owes ending the agents a session's node opened, before that session goes; a shell that already exited ends nothing, so a restart does not. */
export type BeforeKill = (nodeId: string) => Promise<unknown>;

/* The CLIs as a login names them: the CLI's own login command, if it has one, and its name. */
export interface LoginCommands {
    commandOf(kind: AgentKind): string | undefined;
    nameOf(kind: AgentKind): string;
}

export function registerSessionHandlers(
    dispatcher: Dispatcher,
    manager: SessionManager,
    beforeKill?: BeforeKill,
    logins?: LoginCommands,
    machineOf?: MachineOfNode
): void {
    dispatcher.register('session.create', async (payload, client) => {
        refuseBoundNode(machineOf, payload.sessionId);
        const { endsWithClient, ...options } = payload;
        if (!endsWithClient) {
            return manager.create(options);
        }
        // A client's shell never holds a command, so one may not ride along past a person's approval.
        if (options.command !== undefined || options.agent !== undefined) {
            throw new SessionError('client-shell-command', 'A shell that ends with its client starts nothing of its own');
        }
        const created = await manager.create({ ...options, fresh: true, forClient: { clientId: client.id, label: 'Shell' } });
        // As with a login: a client that left while the shell started had its others ended before this one was there.
        if (client.closed) {
            await manager.kill(created.sessionId);
        }
        return created;
    });

    /* No `cwd`, so the shell starts in the home folder. The default account is named outright, since a
       launch without one would take the person's pick for new agents instead. */
    dispatcher.register('session.login', async (payload, client) => {
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
    });

    dispatcher.register('session.attach', async (payload, client) => {
        refuseBoundNode(machineOf, payload.sessionId);
        const started = performance.now();
        const attached = await manager.attach(
            payload.sessionId,
            client.id,
            payload.follow ? undefined : payload.cols,
            payload.follow ? undefined : payload.rows
        );
        // The machine's side of an attach: the screen it serializes for this client.
        recordTiming('terminalAttachMs', performance.now() - started);
        return attached;
    });

    dispatcher.register('session.detach', (payload, client) => {
        manager.detach(payload.sessionId, client.id);
        return {};
    });

    dispatcher.register('session.write', (payload, client) => {
        manager.write(payload.sessionId, payload.data, client.id);
        return {};
    });

    dispatcher.register('session.resize', (payload, client) => {
        manager.resize(payload.sessionId, payload.cols, payload.rows, client.id);
        return {};
    });

    dispatcher.register('session.kill', async (payload) => {
        if (manager.get(payload.sessionId)?.exited === false) {
            await beforeKill?.(payload.sessionId);
        }
        await manager.kill(payload.sessionId);
        return {};
    });

    dispatcher.register('session.clear', async (payload) => {
        await manager.clear(payload.sessionId);
        return {};
    });

    dispatcher.register('session.runHeld', async (payload) => {
        await manager.runHeld(payload.sessionId);
        return {};
    });

    dispatcher.register('session.list', () => ({ sessions: manager.list() }));

    dispatcher.register('agent.resume', async (payload) => {
        await manager.resumeAgent(payload.sessionId);
        return {};
    });
}
