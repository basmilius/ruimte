import { translate, type Dispatcher } from '../dispatcher.ts';
import type { LanguageHost } from '../language/host.ts';

/* Every request here comes from a client, so an install or a restart is a person's. */
export function registerLanguageHandlers(dispatcher: Dispatcher, host: LanguageHost): void {
    dispatcher.register('language.status', (payload) => translate(async () => ({ servers: await host.status(payload.projectId) })));

    dispatcher.register('language.install', (payload) => translate(async () => ({ status: await host.install(payload.server) })));

    dispatcher.register('language.restart', (payload) => translate(async () => ({ status: await host.restart(payload.projectId, payload.server) })));

    dispatcher.register('language.log', (payload) => translate(async () => ({ lines: await host.log(payload.projectId, payload.server) })));

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
