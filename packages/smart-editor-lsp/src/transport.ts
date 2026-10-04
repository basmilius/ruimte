import type { Disposable, LspTransport, RpcMessage } from './protocol.ts';

const DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/*
 * The listeners of a transport. A message that arrives before anyone listens is held and handed to
 * the first listener, since a server may speak the moment its pipe opens.
 */
class TransportEvents {
    closed = false;
    private readonly messages = new Set<(message: unknown) => void>();
    private readonly closes = new Set<(error?: Error) => void>();
    private backlog: unknown[] = [];
    private error?: Error;

    onMessage = (listener: (message: unknown) => void): Disposable => {
        this.messages.add(listener);
        for (const message of this.backlog.splice(0)) {
            listener(message);
        }
        return {
            dispose: () => {
                this.messages.delete(listener);
            }
        };
    };

    onClose = (listener: (error?: Error) => void): Disposable => {
        this.closes.add(listener);
        if (this.closed) {
            listener(this.error);
        }
        return {
            dispose: () => {
                this.closes.delete(listener);
            }
        };
    };

    receive(message: unknown): void {
        if (this.closed) {
            return;
        }
        if (this.messages.size === 0) {
            this.backlog.push(message);
            return;
        }
        for (const listener of this.messages) {
            listener(message);
        }
    }

    finish(error?: Error): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.error = error;
        this.backlog = [];
        for (const listener of this.closes) {
            listener(error);
        }
        this.closes.clear();
        this.messages.clear();
    }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
    if (chunks.length === 1) {
        return chunks[0];
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
    }
    return joined;
}

function indexOfHeaderEnd(bytes: Uint8Array): number {
    for (let i = 0; i + 3 < bytes.length; i++) {
        if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
            return i;
        }
    }
    return -1;
}

/* Reads `Content-Length` framed messages, the way a language server speaks over stdio. */
export class ContentLengthDecoder {
    private readonly maxMessageBytes: number;
    private chunks: Uint8Array[] = [];
    private size = 0;
    private length: number | null = null;

    constructor(maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES) {
        this.maxMessageBytes = maxMessageBytes;
    }

    /* Every complete message in what has arrived so far. Throws on a frame it cannot read, after which the stream is no use. */
    accept(chunk: Uint8Array): unknown[] {
        this.chunks.push(chunk);
        this.size += chunk.length;
        const messages: unknown[] = [];
        while (true) {
            if (this.length === null) {
                const buffer = concat(this.chunks, this.size);
                this.chunks = [buffer];
                const boundary = indexOfHeaderEnd(buffer);
                if (boundary < 0) {
                    if (buffer.length > MAX_HEADER_BYTES) {
                        throw new Error('LSP header is too large');
                    }
                    break;
                }
                const header = new TextDecoder().decode(buffer.subarray(0, boundary));
                const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
                if (!match || boundary > MAX_HEADER_BYTES) {
                    throw new Error('Invalid LSP Content-Length header');
                }
                const length = Number(match[1]);
                if (!length || length > this.maxMessageBytes) {
                    throw new Error('LSP message is too large');
                }
                this.length = length;
                this.chunks = [buffer.subarray(boundary + 4)];
                this.size = buffer.length - boundary - 4;
            }
            if (this.size < this.length) {
                break;
            }
            const buffer = concat(this.chunks, this.size);
            messages.push(JSON.parse(new TextDecoder().decode(buffer.subarray(0, this.length))));
            this.chunks = [buffer.subarray(this.length)];
            this.size = buffer.length - this.length;
            this.length = null;
        }
        return messages;
    }
}

export function encodeMessage(message: RpcMessage): Uint8Array {
    const body = new TextEncoder().encode(JSON.stringify(message));
    const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
    const framed = new Uint8Array(header.length + body.length);
    framed.set(header, 0);
    framed.set(body, header.length);
    return framed;
}

/* What a stdio transport needs of a process: its stdin and stdout as bytes, which the host adapts a child to. */
export interface ByteStream {
    write(chunk: Uint8Array): void | Promise<void>;
    onData(listener: (chunk: Uint8Array) => void): Disposable;
    /* Called once, when the stream ended; an error when it ended badly. */
    onClose(listener: (error?: Error) => void): Disposable;
    close(): void | Promise<void>;
}

export function createStreamTransport(stream: ByteStream, options: { maxMessageBytes?: number } = {}): LspTransport {
    const events = new TransportEvents();
    const decoder = new ContentLengthDecoder(options.maxMessageBytes);
    stream.onData((chunk) => {
        try {
            for (const message of decoder.accept(chunk)) {
                events.receive(message);
            }
        } catch (error) {
            events.finish(asError(error));
            void Promise.resolve(stream.close()).catch(() => undefined);
        }
    });
    stream.onClose((error) => events.finish(error));
    return {
        onMessage: events.onMessage,
        onClose: events.onClose,
        async send(message) {
            if (events.closed) {
                throw new Error('LSP stream is closed');
            }
            await stream.write(encodeMessage(message));
        },
        async close() {
            events.finish();
            await stream.close();
        }
    };
}

/* Two ends of one connection in memory: what one sends the other receives, as JSON and one tick later. Closing either ends both. */
export function createMemoryTransportPair(): [LspTransport, LspTransport] {
    const left = new TransportEvents();
    const right = new TransportEvents();
    const end = (inbox: TransportEvents, outbox: TransportEvents): LspTransport => ({
        onMessage: inbox.onMessage,
        onClose: inbox.onClose,
        send(message) {
            if (inbox.closed || outbox.closed) {
                throw new Error('LSP transport is closed');
            }
            const copy: unknown = JSON.parse(JSON.stringify(message));
            queueMicrotask(() => outbox.receive(copy));
        },
        close() {
            inbox.finish();
            outbox.finish();
        }
    });
    return [end(left, right), end(right, left)];
}

export interface WebSocketTransportOptions {
    protocols?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
    createWebSocket?: (url: string, protocols?: string[]) => WebSocket;
}

const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;

/* JSON text frames over a WebSocket, which a browser can open and a daemon can serve. */
export async function connectWebSocket(url: string, options: WebSocketTransportOptions = {}): Promise<LspTransport> {
    if (options.signal?.aborted) {
        throw new Error('WebSocket connection cancelled');
    }
    const socket = options.createWebSocket ? options.createWebSocket(url, options.protocols) : new WebSocket(url, options.protocols);
    const events = new TransportEvents();
    socket.addEventListener('message', (event) => {
        try {
            if (typeof event.data !== 'string') {
                throw new Error('LSP WebSocket expects JSON text frames');
            }
            events.receive(JSON.parse(event.data));
        } catch (error) {
            events.finish(asError(error));
            socket.close(1003, 'Invalid JSON message');
        }
    });
    socket.addEventListener('close', (event) => events.finish(event.code === 1000 ? undefined : new Error(`LSP WebSocket closed (${event.code})`)));
    socket.addEventListener('error', () => events.finish(new Error('LSP WebSocket failed')));
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('LSP WebSocket connection timed out')), options.timeoutMs ?? 10_000);
        const cleanup = (): void => {
            clearTimeout(timer);
            socket.removeEventListener('open', open);
            socket.removeEventListener('error', failed);
            socket.removeEventListener('close', closed);
            options.signal?.removeEventListener('abort', abort);
        };
        const fail = (reason: Error): void => {
            cleanup();
            socket.close();
            reject(reason);
        };
        const open = (): void => {
            cleanup();
            resolve();
        };
        const failed = (): void => fail(new Error('LSP WebSocket connection failed'));
        const closed = (): void => fail(new Error('LSP WebSocket closed before opening'));
        const abort = (): void => fail(new Error('LSP WebSocket connection cancelled'));
        socket.addEventListener('open', open, { once: true });
        socket.addEventListener('error', failed, { once: true });
        socket.addEventListener('close', closed, { once: true });
        options.signal?.addEventListener('abort', abort, { once: true });
    });
    return {
        onMessage: events.onMessage,
        onClose: events.onClose,
        send(message) {
            if (events.closed || socket.readyState !== 1) {
                throw new Error('LSP WebSocket is closed');
            }
            if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
                throw new Error('LSP WebSocket send buffer is full');
            }
            socket.send(JSON.stringify(message));
        },
        close() {
            events.finish();
            socket.close(1000);
        }
    };
}
