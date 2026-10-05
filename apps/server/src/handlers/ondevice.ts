import { sendEvent, translate, type Dispatcher } from '../dispatcher.ts';
import type { OnDeviceModel } from '../ondevice/model.ts';

/*
 * Anything that reaches the daemon may ask: the model is the machine's own, answers one request at a time
 * of a short prompt, and the code in a prompt goes no further than the helper on this machine.
 */
export function registerOnDeviceHandlers(dispatcher: Dispatcher, model: OnDeviceModel): void {
    const running = new Map<string, AbortController>();

    dispatcher.register('ondevice.status', () => translate(() => model.status()));

    dispatcher.register('ondevice.generate', (payload, client) =>
        translate(async () => {
            // A client's own ids may repeat across clients, so the key names the socket as well.
            const key = `${client.id}\0${payload.id}`;
            const controller = new AbortController();
            running.get(key)?.abort();
            running.set(key, controller);
            try {
                return await model.generate(
                    {
                        purpose: payload.purpose,
                        prompt: payload.prompt,
                        onText: (text) => {
                            if (client.closed) {
                                controller.abort();
                            } else if (payload.stream === true) {
                                sendEvent(client, 'ondevice.text', { id: payload.id, text });
                            }
                        }
                    },
                    controller.signal
                );
            } finally {
                if (running.get(key) === controller) {
                    running.delete(key);
                }
            }
        })
    );

    dispatcher.register('ondevice.cancel', (payload, client) => {
        running.get(`${client.id}\0${payload.id}`)?.abort();
        return {};
    });
}
