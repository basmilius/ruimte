import type { EditorAssistGeneratePayload, EditorAssistGenerateResult, EventMap } from '@ruimte/contracts';
import type { ConnectionState } from '@/transport-api/transport';

/* The part of a test's fake transport (`language/fake-daemon.ts`) that this model answers through. */
interface AssistTransport {
    connection: ConnectionState;
    answers: Map<string, (payload: never) => unknown>;
    emit(event: 'editor.text', payload: EventMap['editor.text']): void;
}

/*
 * The model of a machine as a test sees it: availability, the requests that came, and answers a test
 * gives when it wants them, so streaming, cancelling and a late answer are all deterministic.
 */
export class FakeEditorAssistModel {
    readonly requests: EditorAssistGeneratePayload[] = [];
    readonly cancels: string[] = [];
    private readonly waiting = new Map<string, (result: EditorAssistGenerateResult) => void>();
    private readonly transport: AssistTransport;

    constructor(transport: AssistTransport, options: { available?: boolean; reason?: string } = {}) {
        this.transport = transport;
        transport.connection = {
            ...transport.connection,
            features: [...(transport.connection.features ?? []), 'editor.status', 'editor.generate', 'editor.cancel']
        };
        transport.answers.set('editor.status', () => ({
            available: options.available ?? true,
            ...(options.reason === undefined ? {} : { reason: options.reason })
        }));
        transport.answers.set(
            'editor.generate',
            (payload: EditorAssistGeneratePayload) =>
                new Promise<EditorAssistGenerateResult>((resolve) => {
                    this.requests.push(payload);
                    this.waiting.set(payload.id, resolve);
                })
        );
        transport.answers.set('editor.cancel', (payload: { id: string }) => {
            this.cancels.push(payload.id);
            this.waiting.get(payload.id)?.({ state: 'aborted', text: '' });
            return {};
        });
    }

    get last(): EditorAssistGeneratePayload {
        return this.requests.at(-1)!;
    }

    /* The text so far of the last request, as the daemon streams it. */
    stream(text: string): void {
        this.transport.emit('editor.text', { id: this.last.id, text });
    }

    answer(text: string): void {
        this.waiting.get(this.last.id)?.({ state: 'done', text });
    }
}
