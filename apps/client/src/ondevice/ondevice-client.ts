import i18next from 'i18next';
import type { OnDeviceGenerateResult, OnDevicePurpose, OnDeviceStatusResult } from '@ruimte/contracts';
import { TransportError, type Transport } from '@/transport/transport';

export interface OnDeviceRequest {
    readonly purpose: OnDevicePurpose;
    readonly prompt: string;
    /* The text so far, each time it grows. Without it the text comes once, at the end. */
    readonly onText?: (text: string) => void;
}

/* How long an answer about the model is believed: Apple Intelligence can be switched on while a window is open, and a hover should not ask the machine each time. */
const STATUS_TTL_MS = 30_000;

/*
 * The model on a machine, as the editor reaches it: whether it is there, and one-shot generations that
 * stream and can be stopped. The prompt goes to the machine's own helper and never anywhere else.
 */
export class OnDeviceClient {
    private readonly transport: Transport;
    private readonly now: () => number;
    private known: { at: number; status: OnDeviceStatusResult } | null = null;
    private asking: Promise<OnDeviceStatusResult> | null = null;
    private sequence = 0;

    constructor(transport: Transport, now: () => number = () => Date.now()) {
        this.transport = transport;
        this.now = now;
    }

    /* The last answer if it is fresh, else the machine's; never rejects. */
    availability(): Promise<OnDeviceStatusResult> {
        if (this.known !== null && this.now() - this.known.at < STATUS_TTL_MS) {
            return Promise.resolve(this.known.status);
        }
        this.asking ??= this.transport
            .request('ondevice.status', {})
            .catch((): OnDeviceStatusResult => ({ available: false, reason: i18next.t('panels:language.onDevice.oldMachine') }))
            .then((status) => {
                this.known = { at: this.now(), status };
                this.asking = null;
                return status;
            });
        return this.asking;
    }

    /* The answer of the last `availability`, or null before there was one. */
    get lastKnown(): OnDeviceStatusResult | null {
        return this.known?.status ?? null;
    }

    /* Forgets what it knows, for a person who just turned Apple Intelligence on and asks again. */
    refresh(): Promise<OnDeviceStatusResult> {
        this.known = null;
        return this.availability();
    }

    /* Resolves `aborted` when the signal fires first; rejects with a `TransportError` carrying the machine's code and reason. */
    async generate(request: OnDeviceRequest, signal?: AbortSignal): Promise<OnDeviceGenerateResult> {
        if (signal?.aborted) {
            return { state: 'aborted', text: '' };
        }
        const id = `od-${++this.sequence}`;
        const off = request.onText === undefined ? null : this.transport.on('ondevice.text', (event) => event.id === id && request.onText?.(event.text));
        const cancel = (): void => void this.transport.request('ondevice.cancel', { id }).catch(() => undefined);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            const result = await this.transport.request('ondevice.generate', {
                id,
                purpose: request.purpose,
                prompt: request.prompt,
                stream: request.onText !== undefined
            });
            return signal?.aborted ? { state: 'aborted', text: '' } : result;
        } catch (error) {
            if (signal?.aborted) {
                return { state: 'aborted', text: '' };
            }
            throw error instanceof TransportError && error.code === 'unknown-request'
                ? new TransportError('unavailable', i18next.t('panels:language.onDevice.oldMachine'))
                : error;
        } finally {
            off?.();
            signal?.removeEventListener('abort', cancel);
        }
    }
}

const clients = new WeakMap<Transport, OnDeviceClient>();

/* One client per transport, so every editor of a machine shares what it learned about the model. */
export function onDeviceClientFor(transport: Transport): OnDeviceClient {
    let client = clients.get(transport);
    if (client === undefined) {
        client = new OnDeviceClient(transport);
        clients.set(transport, client);
    }
    return client;
}
