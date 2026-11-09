import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { LanguageHost } from '../language/host.ts';

export interface LanguageDeps {
    host: LanguageHost;
}

/* Every request here comes from a client, so an install or a restart is a person's. */
export function languageArea(deps: LanguageDeps): Area {
    const { host } = deps;

    return {
        name: 'language',
        sources: [host],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [{ phase: 'end', label: 'Stopping language servers', run: () => host.close() }]
    };
}

function registerRequests(dispatcher: Dispatcher, { host }: LanguageDeps): void {
    dispatcher.register('language.status', async (payload) => ({ servers: await host.status(payload.projectId) }));

    dispatcher.register('language.install', async (payload) => ({ status: await host.install(payload.server) }));

    dispatcher.register('language.prefer', async (payload) => ({ status: await host.prefer(payload.server) }));

    dispatcher.register('language.rollback', async (payload) => ({ status: await host.rollback(payload.server) }));

    dispatcher.register('language.restart', async (payload) => ({ status: await host.restart(payload.projectId, payload.server) }));

    /* Lets a server build code an agent just wrote, so only the local secret turns it on, as it alone saves a server of a person's own. */
    dispatcher.register('language.worktreeBuild', async (payload) => ({ servers: await host.setWorktreeBuild(payload.projectId, payload.on) }), {
        owner: true
    });

    dispatcher.register('language.log', async (payload) => ({ lines: await host.log(payload.projectId, payload.server) }));

    dispatcher.register('language.custom.list', async () => ({ servers: host.customList() }));

    /*
     * Saving a server of a person's own approves starting its command on this machine, so only the local
     * secret saves, removes or probes one: a client the machine let in is not the owner of the machine.
     */
    dispatcher.register('language.custom.save', async (payload) => ({ server: await host.customSave(payload.server) }), { owner: true });

    dispatcher.register(
        'language.custom.remove',
        async (payload) => {
            await host.customRemove(payload.id);
            return {};
        },
        { owner: true }
    );

    dispatcher.register('language.custom.check', (payload) => host.customCheck(payload.command), { owner: true });

    dispatcher.register('language.document.open', (payload, client) => host.open(client.id, payload));

    dispatcher.register('language.document.change', (payload) => host.change(payload));

    dispatcher.register('language.document.close', async (payload, client) => {
        await host.closeDocument(client.id, payload);
        return {};
    });

    dispatcher.register('language.request', (payload) => host.request(payload));

    dispatcher.register('language.willSave', async (payload) => {
        await host.willSave(payload);
        return {};
    });

    dispatcher.register('language.workspaceProblems', async (payload, client) => {
        const { servers, files } = await host.workspaceProblems(client.id, payload.projectId);

        return { servers, files };
    });

    dispatcher.register('language.messageAnswer', async (payload) => {
        host.answerMessage(payload);
        return {};
    });

    // A debugging switch like a restart, so any client may set it.
    dispatcher.register('language.trace', async (payload) => ({ status: await host.trace(payload.projectId, payload.server, payload.value) }));

    dispatcher.register('language.command', (payload, client) => host.command(client.id, payload));

    dispatcher.register('language.edit.answer', async (payload, client) => {
        host.answerEdit(client.id, payload);
        return {};
    });
}
