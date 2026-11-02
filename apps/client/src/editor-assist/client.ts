import type { EditorAssistGenerateResult, EditorAssistPurpose, EditorAssistStatusResult } from '@ruimte/contracts';
import { machineAnswers } from '@/transport/features';
import { TransportError, type Transport } from '@/transport/transport';
import { useSettings } from '@/state/settings';

export interface EditorAssistRequest {
    readonly purpose: EditorAssistPurpose;
    readonly prompt: string;
    /* The text so far, each time it grows. Without it the text comes once, at the end. */
    readonly onText?: (text: string) => void;
}

/* A hover reuses availability for thirty seconds unless the chosen model changed. */
const STATUS_TTL_MS = 30_000;

function aborted(): EditorAssistGenerateResult {
    return { state: 'aborted', text: '' };
}

/*
 * The model on a machine, as the editor reaches it: whether it is there, and one-shot generations that
 * stream and can be stopped. The chosen provider receives the prompt through its installed CLI.
 */
export class EditorAssistClient {
    private readonly transport: Transport;
    private readonly now: () => number;
    private known: { at: number; status: EditorAssistStatusResult } | null = null;
    private asking: Promise<EditorAssistStatusResult> | null = null;
    private sequence = 0;
    private agentKey = '';

    constructor(transport: Transport, now: () => number = () => Date.now()) {
        this.transport = transport;
        this.now = now;
    }

    /* The last answer if it is fresh, else the machine's; never rejects. */
    availability(): Promise<EditorAssistStatusResult> {
        if (!machineAnswers(this.transport.connection, 'editor.status')) {
            return Promise.resolve({ available: false });
        }

        const agent = useSettings.getState().aiAssistAgent;
        const key = JSON.stringify(agent);
        if (key !== this.agentKey) {
            this.agentKey = key;
            this.known = null;
            this.asking = null;
        }

        if (this.known !== null && this.now() - this.known.at < STATUS_TTL_MS) {
            return Promise.resolve(this.known.status);
        }
        this.asking ??= this.transport
            .request('editor.status', { agent })
            // A failed ask, a dropped link included, reads as no model, and the caller words it.
            .catch((): EditorAssistStatusResult => ({ available: false }))
            .then((status) => {
                if (this.agentKey === key) {
                    this.known = { at: this.now(), status };
                    this.asking = null;
                }
                return status;
            });
        return this.asking;
    }

    /* The answer of the last `availability`, or null before there was one. */
    get lastKnown(): EditorAssistStatusResult | null {
        return this.known?.status ?? null;
    }

    /* Asks again after the person changed the chosen model or its sign-in. */
    refresh(): Promise<EditorAssistStatusResult> {
        this.known = null;
        return this.availability();
    }

    /* Resolves `aborted` when the signal fires first; rejects with a `TransportError` carrying the machine's code and reason. */
    async generate(request: EditorAssistRequest, signal?: AbortSignal): Promise<EditorAssistGenerateResult> {
        if (signal?.aborted) {
            return aborted();
        }
        if (!machineAnswers(this.transport.connection, 'editor.generate')) {
            throw new TransportError('unavailable', 'Update this machine to use the editor model.');
        }
        const id = `assist-${++this.sequence}`;
        const off = request.onText === undefined ? null : this.transport.on('editor.text', (event) => event.id === id && request.onText?.(event.text));
        const cancel = (): void => void this.transport.request('editor.cancel', { id }).catch(() => undefined);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            const result = await this.transport.request('editor.generate', {
                id,
                purpose: request.purpose,
                agent: useSettings.getState().aiAssistAgent,
                prompt: request.prompt,
                stream: request.onText !== undefined
            });
            return signal?.aborted ? aborted() : result;
        } catch (error) {
            if (signal?.aborted) {
                return aborted();
            }
            throw error;
        } finally {
            off?.();
            signal?.removeEventListener('abort', cancel);
        }
    }
}

const clients = new WeakMap<Transport, EditorAssistClient>();

/* One client per transport, so every editor of a machine shares what it learned about the model. */
export function editorAssistClientFor(transport: Transport): EditorAssistClient {
    let client = clients.get(transport);
    if (client === undefined) {
        client = new EditorAssistClient(transport);
        clients.set(transport, client);
    }
    return client;
}
