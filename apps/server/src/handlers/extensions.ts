import type { Dispatcher } from '../dispatcher.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';

/* A list and a call are for any client let in. What changes what runs on this machine takes its owner. */
export function registerExtensionHandlers(dispatcher: Dispatcher, host: ExtensionHost): void {
    dispatcher.register('extension.list', async () => ({ extensions: await host.list() }));

    dispatcher.register('extension.call', async (payload) => ({ result: await host.call(payload.id, payload.method, payload.args) }));

    dispatcher.register('extension.install', (payload) => host.install(payload.pack), { owner: true });

    dispatcher.register(
        'extension.remove',
        async (payload) => {
            await host.remove(payload.id);

            return {};
        },
        { owner: true }
    );

    dispatcher.register(
        'extension.setEnabled',
        async (payload) => {
            await host.setEnabled(payload.id, payload.enabled);

            return {};
        },
        { owner: true }
    );
}
