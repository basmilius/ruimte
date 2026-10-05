import type { OnDeviceGeneratePayload, OnDeviceGenerateResult } from '@ruimte/contracts';
import type { FakeLanguageTransport } from '@/language/fake-daemon';

/*
 * The model of a machine as a test sees it: availability, the requests that came, and answers a test
 * gives when it wants them, so streaming, cancelling and a late answer are all deterministic.
 */
export class FakeOnDeviceModel {
    readonly requests: OnDeviceGeneratePayload[] = [];
    readonly cancels: string[] = [];
    private readonly waiting = new Map<string, (result: OnDeviceGenerateResult) => void>();
    private readonly transport: FakeLanguageTransport;

    constructor(transport: FakeLanguageTransport, options: { available?: boolean; reason?: string } = {}) {
        this.transport = transport;
        transport.answers.set('ondevice.status', () => ({
            available: options.available ?? true,
            ...(options.reason === undefined ? {} : { reason: options.reason })
        }));
        transport.answers.set(
            'ondevice.generate',
            (payload: OnDeviceGeneratePayload) =>
                new Promise<OnDeviceGenerateResult>((resolve) => {
                    this.requests.push(payload);
                    this.waiting.set(payload.id, resolve);
                })
        );
        transport.answers.set('ondevice.cancel', (payload: { id: string }) => {
            this.cancels.push(payload.id);
            this.waiting.get(payload.id)?.({ state: 'aborted', text: '' });
            return {};
        });
    }

    get last(): OnDeviceGeneratePayload {
        return this.requests.at(-1)!;
    }

    /* The text so far of the last request, as the daemon streams it. */
    stream(text: string): void {
        this.transport.emit('ondevice.text', { id: this.last.id, text });
    }

    /* The last request is done with this text. */
    answer(text: string): void {
        this.waiting.get(this.last.id)?.({ state: 'done', text });
    }
}
