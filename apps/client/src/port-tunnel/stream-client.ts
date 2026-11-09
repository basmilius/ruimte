import { PORT_CHUNK_BYTES, type EventMap, type EventType, type PortEndEvent, type RequestMap, type RequestType } from '@ruimte/contracts';
import { base64Of } from '../base64';
import { decodeBase64 } from '../transport-api/piece';
import { fireAndForget } from '../transport-api/transport';

/* As much of a `Transport` as the streams use, so a test or a measurement hands in a plainer one. */
export interface PortTransport {
    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']>;
    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void;
}

export interface PortStreamHandlers {
    data(bytes: Uint8Array): void;
    /* Bytes the machine wrote to the service in all, which frees room for the next ones. */
    flushed(total: number): void;
    /* `reason` is null for a service that finished, else the sentence to tell a person. */
    end(reason: string | null): void;
}

/* How much of what the page sent may be unanswered in `port.write` at once; the machine says it on open and this is the ceiling until then. */
const DEFAULT_WINDOW = 256 * 1024;

/* The consumed bytes that pile up before the machine hears of them, a sixteenth of its window. */
const CREDIT_STEP = 16 * 1024;

function randomStreamId(): string {
    return `s-${crypto.randomUUID()}`;
}

/*
 * One stream to a shared port as the page of a client holds it: writes are cut into chunks and pipelined
 * within the window the machine granted, and the bytes that come back are answered with credit only once
 * whoever reads them said they were used. Offsets are checked both ways, so a lost byte ends the stream
 * instead of reaching a page as a hole.
 */
export class PortStreamClient {
    readonly id = randomStreamId();
    private readonly hub: PortStreamHub;
    private readonly handlers: PortStreamHandlers;
    private window = DEFAULT_WINDOW;
    private sent = 0;
    private flushedTotal = 0;
    private queue: Uint8Array[] = [];
    private received = 0;
    private consumedTotal = 0;
    private credited = 0;
    private ended = false;
    private wantsShut = false;
    private shutSent = false;
    private opened = false;

    constructor(hub: PortStreamHub, handlers: PortStreamHandlers) {
        this.hub = hub;
        this.handlers = handlers;
    }

    /** @internal Called by the hub once, to open the stream. */
    async start(grantId: string): Promise<void> {
        const { window } = await this.hub.transport.request('port.open', { streamId: this.id, grantId });

        this.window = window;
        this.opened = true;
        this.pump();
    }

    write(bytes: Uint8Array): void {
        if (this.ended || this.wantsShut || bytes.byteLength === 0) {
            return;
        }

        for (let at = 0; at < bytes.byteLength; at += PORT_CHUNK_BYTES) {
            this.queue.push(bytes.subarray(at, Math.min(at + PORT_CHUNK_BYTES, bytes.byteLength)));
        }

        this.pump();
    }

    /* The bytes of the answer the page took in; the machine hears of them in steps. */
    consumed(bytes: number): void {
        this.consumedTotal += bytes;

        if (!this.ended && this.consumedTotal - this.credited >= CREDIT_STEP) {
            this.credit();
        }
    }

    closeWrite(): void {
        if (this.ended || this.wantsShut) {
            return;
        }

        this.wantsShut = true;
        this.pump();
    }

    close(): void {
        if (this.ended) {
            return;
        }

        this.ended = true;
        this.hub.forget(this.id);

        if (this.opened) {
            void fireAndForget('port.close', this.hub.transport.request('port.close', { streamId: this.id }));
        }
    }

    /** @internal */
    arrived(offset: number, data: string): void {
        if (this.ended) {
            return;
        }

        const bytes = decodeBase64(data);

        if (offset !== this.received) {
            this.fail('Bytes of the page were lost on the way');

            return;
        }

        this.received += bytes.byteLength;
        this.handlers.data(bytes);
    }

    /** @internal */
    finished(event: PortEndEvent): void {
        if (this.ended) {
            return;
        }

        if (event.offset !== this.received) {
            this.fail('Bytes of the page were lost on the way');

            return;
        }

        this.ended = true;
        this.hub.forget(this.id);
        this.handlers.end(event.reason === 'eof' || event.reason === 'closed' ? null : (event.message ?? 'The connection to the page ended'));
    }

    private credit(): void {
        this.credited = this.consumedTotal;
        void fireAndForget('port.credit', this.hub.transport.request('port.credit', { streamId: this.id, offset: this.credited }));
    }

    private pump(): void {
        while (this.opened && !this.ended && this.queue.length > 0 && this.sent - this.flushedTotal + this.queue[0]!.byteLength <= this.window) {
            const chunk = this.queue.shift()!;
            const offset = this.sent;

            this.sent += chunk.byteLength;
            this.hub.transport.request('port.write', { streamId: this.id, offset, data: base64Of(chunk) }).then(
                ({ flushed }) => {
                    this.flushedTotal = Math.max(this.flushedTotal, flushed);
                    this.handlers.flushed(this.flushedTotal);
                    this.pump();
                },
                (e: unknown) => this.fail(e instanceof Error ? e.message : 'The bytes of the page did not arrive')
            );
        }

        if (this.wantsShut && !this.shutSent && this.opened && !this.ended && this.queue.length === 0 && this.sent === this.flushedTotal) {
            this.shutSent = true;
            void fireAndForget('port.close', this.hub.transport.request('port.close', { streamId: this.id, half: 'write' }));
        }
    }

    /** @internal The link or the tunnel ended under the stream. */
    abort(reason: string): void {
        this.fail(reason, false);
    }

    private fail(reason: string, tell = true): void {
        if (this.ended) {
            return;
        }

        this.ended = true;
        this.hub.forget(this.id);

        if (tell) {
            void fireAndForget('port.close', this.hub.transport.request('port.close', { streamId: this.id }));
        }

        this.handlers.end(reason);
    }
}

/* The streams of one machine connection: it subscribes to the data and end events once and hands each to its stream. */
export class PortStreamHub {
    readonly transport: PortTransport;
    private readonly streams = new Map<string, PortStreamClient>();
    private readonly stops: Array<() => void>;

    constructor(transport: PortTransport) {
        this.transport = transport;
        this.stops = [
            transport.on('port.data', ({ streamId, offset, data }) => this.streams.get(streamId)?.arrived(offset, data)),
            transport.on('port.end', (event) => this.streams.get(event.streamId)?.finished(event))
        ];
    }

    get count(): number {
        return this.streams.size;
    }

    async open(grantId: string, handlers: PortStreamHandlers): Promise<PortStreamClient> {
        const stream = new PortStreamClient(this, handlers);

        // Registered first, so data that comes right behind the answer has a stream to go to.
        this.streams.set(stream.id, stream);

        try {
            await stream.start(grantId);
        } catch (e) {
            this.streams.delete(stream.id);
            throw e;
        }

        return stream;
    }

    forget(streamId: string): void {
        this.streams.delete(streamId);
    }

    /* The link went: every stream ends for its page, and a page that asks again opens a new one. */
    abortAll(reason: string): void {
        for (const stream of [...this.streams.values()]) {
            stream.abort(reason);
        }
    }

    /* The tunnel ended: the hub stops listening, and every stream ends. */
    dispose(reason: string): void {
        for (const stop of this.stops) {
            stop();
        }

        this.abortAll(reason);
    }
}
