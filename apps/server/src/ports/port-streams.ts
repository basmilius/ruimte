import { CodedError } from '@adecore/agents';
import {
    PORT_ANSWER_MS,
    PORT_BUFFER_BYTES,
    PORT_CHUNK_BYTES,
    PORT_CLIENT_BYTES,
    PORT_CLIENT_STREAMS,
    PORT_MACHINE_STREAMS,
    PORT_WINDOW_BYTES,
    type PortEndEvent,
    type PortHost
} from '@ruimte/contracts';
import { sendEvent, type ClientConnection } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import type { PortGrants } from './port-grants.ts';

/* What a service on loopback says to a stream. */
export interface PortSocketHandlers {
    data(bytes: Uint8Array): void;
    /* The service closed its side, or the connection failed (`error` is then the reason). */
    ended(error: string | null): void;
}

/* One connection to the service of a grant. */
export interface PortSocket {
    /* Settles once every byte went to the service, which is what frees the client's window. */
    write(bytes: Uint8Array): Promise<void>;
    shutdownWrite(): void;
    close(): void;
    /* Stops `data` until `resume`, so a slow client makes the service wait instead of this machine buffer. */
    pause(): void;
    resume(): void;
}

/* Connects to one literal address; rejects when nothing answers. */
export type PortConnect = (host: PortHost, port: number, handlers: PortSocketHandlers) => Promise<PortSocket>;

/* A clock the streams use for the five seconds an answer may take and for rechecking a full channel. */
export interface PortTimers {
    after(ms: number, fire: () => void): () => void;
}

export interface PortStreamsOptions {
    grants: PortGrants;
    connect: PortConnect;
    timers: PortTimers;
}

/* Bytes of one stream's output that wait here for credit or room on the channel before its service is told to pause. */
const STREAM_QUEUE_BYTES = 64 * 1024;

/*
 * Past this a service that ignored the pause is cut off rather than buffered. A pause holds from the next read on,
 * and one read of Bun's sockets is up to 512 KiB (`scripts/measure-port-bridge`), so the queue may pass its 64 KiB by that much.
 */
const STREAM_OVERLOAD_BYTES = STREAM_QUEUE_BYTES + 2 * 512 * 1024;

/* A full channel is asked again this often when no drain came, since a drain only fires when the channel crossed its own threshold. */
const RECHECK_MS = 20;

export class PortStreamError extends CodedError {}

type Closing = Pick<PortEndEvent, 'reason' | 'message'>;

interface Stream {
    readonly id: string;
    readonly client: ClientConnection;
    readonly grantId: string;
    socket: PortSocket | null;
    ended: boolean;
    /* Bytes the client sent, and bytes of them the service took. */
    received: number;
    flushed: number;
    writeShut: boolean;
    writeTail: Promise<void>;
    /* Bytes sent to the client, and bytes of them it said it consumed. */
    sent: number;
    consumed: number;
    queue: Uint8Array[];
    queued: number;
    paused: boolean;
    closing: Closing | null;
    gone: Promise<'gone'>;
    leave(): void;
}

interface ClientStreams {
    streams: Map<string, Stream>;
    stopDrain: (() => void) | null;
    recheck: (() => void) | null;
}

function encodedBytes(length: number): number {
    // The base64 of the chunk and the envelope around it.
    return Math.ceil(length / 3) * 4 + 120;
}

/*
 * The streams of shared ports, one connection to a granted loopback endpoint each. A stream belongs to the client
 * that opened it and to nobody else; the service never reads a destination from a client. Bytes toward a client
 * go as `port.data` events only within the credit it granted, within a budget of the channel, and wait in a
 * small queue otherwise while the service is paused. Bytes toward the service are acknowledged once written.
 */
export class PortStreams {
    private readonly options: PortStreamsOptions;
    private readonly clients = new Map<string, ClientStreams>();

    constructor(options: PortStreamsOptions) {
        this.options = options;
        options.grants.onRevoked((grant) => {
            for (const stream of this.all()) {
                if (stream.grantId === grant.id) {
                    this.finish(stream, { reason: 'revoked', message: 'Sharing this port was stopped' }, true);
                }
            }
        });
    }

    count(): number {
        return this.all().length;
    }

    async open(client: ClientConnection, streamId: string, grantId: string): Promise<{ window: number }> {
        const grant = this.options.grants.find(grantId);

        if (grant === undefined) {
            throw new PortStreamError('unknown-grant', 'That port is not shared');
        }

        const denied = this.options.grants.deniedReason(grant);

        if (denied !== null) {
            throw new PortStreamError('port-denied', denied);
        }

        const entry = this.entryOf(client);

        if (entry.streams.has(streamId)) {
            throw new PortStreamError('stream-exists', 'That stream is already open');
        }

        if (entry.streams.size >= PORT_CLIENT_STREAMS || this.count() >= PORT_MACHINE_STREAMS) {
            throw new PortStreamError('port-busy', 'Too many connections to shared ports are open. Wait for one to finish');
        }

        let leave: () => void = () => undefined;
        const stream: Stream = {
            id: streamId,
            client,
            grantId,
            socket: null,
            ended: false,
            received: 0,
            flushed: 0,
            writeShut: false,
            writeTail: Promise.resolve(),
            sent: 0,
            consumed: 0,
            queue: [],
            queued: 0,
            paused: false,
            closing: null,
            gone: new Promise<'gone'>((resolve) => {
                leave = () => resolve('gone');
            }),
            leave: () => leave()
        };

        entry.streams.set(streamId, stream);

        let socket: PortSocket;

        try {
            socket = await this.options.connect(grant.host, grant.port, {
                data: (bytes) => this.arrived(stream, bytes),
                ended: (error) => this.serviceEnded(stream, error)
            });
        } catch (e) {
            this.drop(stream);
            throw new PortStreamError(
                'port-unreachable',
                `Nothing answers on ${grant.host === '::1' ? '[::1]' : grant.host} port ${grant.port}: ${errorText(e)}`
            );
        }

        if (stream.ended) {
            socket.close();
            throw new PortStreamError('stream-gone', 'The stream ended while it was opening');
        }

        stream.socket = socket;

        return { window: PORT_WINDOW_BYTES };
    }

    /* Hands bytes to the service. Settles with how many it took in all once they are written; a stall of five seconds ends the stream. */
    async write(client: ClientConnection, streamId: string, offset: number, bytes: Uint8Array): Promise<{ flushed: number }> {
        const stream = this.require(client, streamId);

        if (stream.writeShut) {
            throw new PortStreamError('stream-closed', 'That stream stopped sending');
        }

        if (offset !== stream.received) {
            // A replay or a gap: a write is never repeated, so the stream cannot be trusted any more.
            this.finish(stream, { reason: 'error', message: 'The bytes did not follow one another' }, true);
            throw new PortStreamError('bad-offset', 'A write did not continue where the last one ended');
        }

        if (bytes.byteLength > PORT_CHUNK_BYTES || stream.received - stream.flushed + bytes.byteLength > PORT_WINDOW_BYTES) {
            this.finish(stream, { reason: 'overload', message: 'More was sent than the window allowed' }, true);
            throw new PortStreamError('port-window', 'More was sent than the window allowed');
        }

        if (this.inboundOutstanding(client) + bytes.byteLength > PORT_CLIENT_BYTES) {
            this.finish(stream, { reason: 'overload', message: 'This client has too many bytes waiting' }, true);
            throw new PortStreamError('port-busy', 'Too many bytes wait to reach shared ports');
        }

        const socket = stream.socket;

        if (socket === null) {
            throw new PortStreamError('stream-gone', 'The stream is not open yet');
        }

        stream.received += bytes.byteLength;
        const written = socket.write(bytes);

        stream.writeTail = written.then(
            () => undefined,
            () => undefined
        );

        let cancel: () => void = () => undefined;
        const timeout = new Promise<'timeout'>((resolve) => {
            cancel = this.options.timers.after(PORT_ANSWER_MS, () => resolve('timeout'));
        });

        try {
            const outcome = await Promise.race([written.then(() => 'written' as const), stream.gone, timeout]);

            if (outcome === 'timeout') {
                this.finish(stream, { reason: 'error', message: 'The service stopped reading' }, true);
                throw new PortStreamError('port-stalled', 'The service did not take the bytes in time. The request may not have reached it');
            }

            if (outcome === 'gone') {
                throw new PortStreamError('stream-gone', 'The stream ended before the bytes were written');
            }

            stream.flushed += bytes.byteLength;

            return { flushed: stream.flushed };
        } catch (e) {
            if (e instanceof PortStreamError) {
                throw e;
            }

            this.finish(stream, { reason: 'error', message: errorText(e) }, true);
            throw new PortStreamError('stream-gone', 'The service closed before the bytes were written');
        } finally {
            cancel();
        }
    }

    /* The client consumed `offset` bytes in all. A number it already gave, or one past what was sent, adds nothing. */
    credit(client: ClientConnection, streamId: string, offset: number): void {
        const stream = this.require(client, streamId);

        stream.consumed = Math.max(stream.consumed, Math.min(offset, stream.sent));
        this.pumpClient(client.id);
    }

    /* `half: 'write'` ends what the client sends once the bytes before it are written; otherwise the stream ends here without a word to the client. */
    close(client: ClientConnection, streamId: string, half: 'write' | undefined): void {
        const stream = this.require(client, streamId);

        if (half === 'write') {
            if (stream.writeShut) {
                return;
            }

            stream.writeShut = true;
            void stream.writeTail.then(() => stream.socket?.shutdownWrite());

            return;
        }

        this.finish(stream, null, false);
    }

    /* A client went, so everything it opened goes with it. */
    channelClosed(clientId: string): void {
        const entry = this.clients.get(clientId);

        if (entry === undefined) {
            return;
        }

        for (const stream of [...entry.streams.values()]) {
            this.finish(stream, null, false);
        }

        entry.stopDrain?.();
        entry.recheck?.();
        this.clients.delete(clientId);
    }

    private all(): Stream[] {
        return [...this.clients.values()].flatMap((entry) => [...entry.streams.values()]);
    }

    private entryOf(client: ClientConnection): ClientStreams {
        let entry = this.clients.get(client.id);

        if (entry === undefined) {
            entry = { streams: new Map(), stopDrain: null, recheck: null };
            this.clients.set(client.id, entry);
        }

        return entry;
    }

    /* A handle another client holds answers as an unknown one, so a stream id never confirms that it exists. */
    private require(client: ClientConnection, streamId: string): Stream {
        const stream = this.clients.get(client.id)?.streams.get(streamId);

        if (stream === undefined) {
            throw new PortStreamError('unknown-stream', 'That stream is not open');
        }

        return stream;
    }

    private inboundOutstanding(client: ClientConnection): number {
        let total = 0;

        for (const stream of this.clients.get(client.id)?.streams.values() ?? []) {
            total += stream.received - stream.flushed;
        }

        return total;
    }

    private outboundTotal(entry: ClientStreams): number {
        let total = 0;

        for (const stream of entry.streams.values()) {
            total += stream.sent - stream.consumed + stream.queued;
        }

        return total;
    }

    private arrived(stream: Stream, bytes: Uint8Array): void {
        if (stream.ended || bytes.byteLength === 0) {
            return;
        }

        stream.queue.push(bytes);
        stream.queued += bytes.byteLength;

        this.pumpClient(stream.client.id);

        if (stream.queued > STREAM_OVERLOAD_BYTES) {
            this.finish(stream, { reason: 'overload', message: 'The client reads slower than the service writes' }, true);

            return;
        }

        this.balance(stream);
    }

    private serviceEnded(stream: Stream, error: string | null): void {
        if (stream.ended || stream.closing !== null) {
            return;
        }

        stream.closing = error === null ? { reason: 'eof' } : { reason: 'error', message: error.slice(0, 300) };
        this.pumpClient(stream.client.id);
    }

    /* Pauses the service of a stream whose output backs up, and lets it go again once there is room. */
    private balance(stream: Stream): void {
        const entry = this.clients.get(stream.client.id);

        if (stream.ended || stream.socket === null || entry === undefined) {
            return;
        }

        const full = stream.queued >= STREAM_QUEUE_BYTES || this.outboundTotal(entry) >= PORT_CLIENT_BYTES;

        if (full && !stream.paused) {
            stream.paused = true;
            stream.socket.pause();
        } else if (!full && stream.paused && stream.queued < STREAM_QUEUE_BYTES / 2) {
            stream.paused = false;
            stream.socket.resume();
        }
    }

    private pumpClient(clientId: string): void {
        const entry = this.clients.get(clientId);

        if (entry === undefined) {
            return;
        }

        for (const stream of [...entry.streams.values()]) {
            if (!this.pump(stream)) {
                this.waitForRoom(entry, stream.client);
            }

            this.balance(stream);
        }
    }

    /* False when the channel had no room for the next chunk. */
    private pump(stream: Stream): boolean {
        const { client } = stream;

        while (!stream.ended && stream.queue.length > 0) {
            const credit = PORT_WINDOW_BYTES - (stream.sent - stream.consumed);

            if (credit <= 0) {
                return true;
            }

            const head = stream.queue[0]!;
            const length = Math.min(PORT_CHUNK_BYTES, credit, head.byteLength);

            if (client.bufferedAmount !== undefined && client.bufferedAmount() + encodedBytes(length) > PORT_BUFFER_BYTES) {
                return false;
            }

            const chunk = head.subarray(0, length);

            if (length === head.byteLength) {
                stream.queue.shift();
            } else {
                stream.queue[0] = head.subarray(length);
            }

            stream.queued -= length;
            sendEvent(client, 'port.data', {
                streamId: stream.id,
                offset: stream.sent,
                data: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64')
            });
            stream.sent += length;
        }

        if (!stream.ended && stream.queue.length === 0 && stream.closing !== null) {
            this.finish(stream, stream.closing, true);
        }

        return true;
    }

    private waitForRoom(entry: ClientStreams, client: ClientConnection): void {
        if (entry.stopDrain === null && client.onDrain !== undefined) {
            entry.stopDrain = client.onDrain(() => this.pumpClient(client.id));
        }

        entry.recheck ??= this.options.timers.after(RECHECK_MS, () => {
            entry.recheck = null;
            this.pumpClient(client.id);
        });
    }

    private drop(stream: Stream): void {
        this.clients.get(stream.client.id)?.streams.delete(stream.id);
    }

    /* Ends a stream once. `tell` sends the client its last word; a close the client asked for, or a client that went, does not. */
    private finish(stream: Stream, closing: Closing | null, tell: boolean): void {
        if (stream.ended) {
            return;
        }

        stream.ended = true;
        stream.queue = [];
        stream.queued = 0;
        this.drop(stream);
        stream.leave();

        try {
            stream.socket?.close();
        } catch (e) {
            console.warn('A shared port socket would not close:', errorText(e));
        }

        if (tell && closing !== null && stream.client.closed !== true) {
            sendEvent(stream.client, 'port.end', { streamId: stream.id, offset: stream.sent, ...closing });
        }
    }
}
