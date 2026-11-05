import { type Dispatcher } from '../dispatcher.ts';
import type { EditorAssistModel } from '../editor-assist/model.ts';
import { sendEvent } from '../wire.ts';

/* The selected CLI receives only the supplied code, without the project's configuration. */
export function registerEditorAssistHandlers(dispatcher: Dispatcher, model: Pick<EditorAssistModel, 'generate' | 'status'>): void {
    const running = new Map<string, AbortController>();

    dispatcher.register('editor.status', (payload) => model.status(payload.agent));

    dispatcher.register('editor.generate', async (payload, client) => {
        // A client's own ids may repeat across clients, so the key names the socket as well.
        const key = `${client.id}\0${payload.id}`;
        const controller = new AbortController();
        running.get(key)?.abort();
        running.set(key, controller);
        try {
            return await model.generate(
                {
                    purpose: payload.purpose,
                    agent: payload.agent,
                    prompt: payload.prompt,
                    onText: (text) => {
                        if (controller.signal.aborted) {
                            return;
                        }

                        if (client.closed) {
                            controller.abort();
                        } else if (payload.stream === true) {
                            sendEvent(client, 'editor.text', { id: payload.id, text });
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
    });

    dispatcher.register('editor.cancel', (payload, client) => {
        running.get(`${client.id}\0${payload.id}`)?.abort();
        return {};
    });
}
