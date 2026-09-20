import type { Dispatcher } from '../dispatcher.ts';
import type { FlowWiring } from '../flows/wiring.ts';
import type { FlowStore } from '../projects/flow-store.ts';
import { translate } from '../dispatcher.ts';
import { viewFileHandlers } from './view-files.ts';

export const registerFlowHandlers = (dispatcher: Dispatcher, store: FlowStore, flows: FlowWiring): void => {
    const handlers = viewFileHandlers(store);

    dispatcher.register('flow.open', handlers.open);
    dispatcher.register('flow.save', async (payload) => {
        const result = await handlers.save(payload);
        // The recipe moved on, so what it listens for is worked out again and the switch is asked once more.
        await flows.rearm(payload.projectId, payload.viewId);
        return result;
    });
    dispatcher.register('flow.close', handlers.close);
    dispatcher.register('flow.copy', handlers.copy);
    dispatcher.register('flow.state', (payload) => translate(() => flows.runner.state(payload.projectId, payload.viewId)));
    /*
     * Only a person gets here: this is a request over a socket, and there is no verb behind it. An
     * agent may write a flow and may never turn one on, which is the same line the rest of the
     * daemon draws around a device it may link and a view it may make.
     */
    dispatcher.register('flow.enable', (payload, client) => translate(() => flows.enable(payload, client?.id ?? 'someone')));
    dispatcher.register('flow.start', (payload) => translate(async () => ({ run: await flows.runner.start(payload) })));
    dispatcher.register('flow.test', (payload, client) => translate(async () => ({ run: await flows.runner.test(payload, client?.id ?? 'someone') })));
    dispatcher.register('flow.arm', (payload, client) => translate(() => flows.runner.armTest(payload, client?.id ?? 'someone')));
};
