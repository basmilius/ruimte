import { isOwner } from '../auth/access.ts';
import { RequestError, translate, type Dispatcher } from '../dispatcher.ts';
import type { LanguageHost } from '../language/host.ts';

/* Every request here comes from a client, so an install or a restart is a person's. */
export function registerLanguageHandlers(dispatcher: Dispatcher, host: LanguageHost): void {
    dispatcher.register('language.status', (payload) => translate(async () => ({ servers: await host.status(payload.projectId) })));

    dispatcher.register('language.install', (payload) => translate(async () => ({ status: await host.install(payload.server) })));

    dispatcher.register('language.restart', (payload) => translate(async () => ({ status: await host.restart(payload.projectId, payload.server) })));

    dispatcher.register('language.log', (payload) => translate(async () => ({ lines: await host.log(payload.projectId, payload.server) })));

    dispatcher.register('language.custom.list', () => translate(async () => ({ servers: host.customList() })));

    /*
     * Saving a server of a person's own approves starting its command on this machine, so only the local
     * secret saves, removes or probes one: a client the machine let in is not the owner of the machine.
     */
    dispatcher.register('language.custom.save', (payload, client) =>
        translate(async () => {
            requireOwner(client.access);
            return { server: await host.customSave(payload.server) };
        })
    );

    dispatcher.register('language.custom.remove', (payload, client) =>
        translate(async () => {
            requireOwner(client.access);
            await host.customRemove(payload.id);
            return {};
        })
    );

    dispatcher.register('language.custom.check', (payload, client) =>
        translate(async () => {
            requireOwner(client.access);
            return host.customCheck(payload.command);
        })
    );

    dispatcher.register('language.document.open', (payload, client) => translate(() => host.open(client.id, payload)));

    dispatcher.register('language.document.change', (payload) => translate(() => host.change(payload)));

    dispatcher.register('language.document.close', (payload, client) =>
        translate(async () => {
            await host.closeDocument(client.id, payload);
            return {};
        })
    );

    dispatcher.register('language.request', (payload) => translate(() => host.request(payload)));

    dispatcher.register('language.command', (payload, client) => translate(() => host.command(client.id, payload)));

    dispatcher.register('language.edit.answer', (payload, client) =>
        translate(async () => {
            host.answerEdit(client.id, payload);
            return {};
        })
    );
}

function requireOwner(access: Parameters<typeof isOwner>[0]): void {
    if (!isOwner(access)) {
        throw new RequestError('forbidden', 'Only a person on this machine can add, change or remove a language server of their own');
    }
}
