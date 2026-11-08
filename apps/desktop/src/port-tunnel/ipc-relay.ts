import { PORT_TUNNEL_MAX_STREAMS, PORT_TUNNEL_MESSAGE_BYTES, PORT_TUNNEL_WINDOW_BYTES, type PortTunnelToPage, type PortTunnelToShell } from '@ruimte/desktop-bridge';
import type { TunnelRelay, TunnelStream, TunnelStreamEvents } from './relay';

interface OpenStream {
    events: TunnelStreamEvents;
    /* Bytes handed to the page, and bytes of them the machine wrote to the service. */
    written: number;
    flushed: number;
    blocked: boolean;
    /* Bytes from the machine that the proxy has not written to its socket yet. */
    unconsumed: number;
    opened: boolean;
    settle: ((stream: TunnelStream | Error) => void) | null;
}

/*
 * A relay whose streams are messages to and from the page of the window that opened the tunnel. It is the
 * whole of what crosses IPC: open, write, consumed, close from the shell and opened, data, flushed, end back.
 * Bytes toward the machine wait for the machine to say it wrote the ones before; bytes from it wait for the
 * proxy to say it wrote them to the page, so neither side buffers more than a window.
 */
export class IpcRelay implements TunnelRelay {
    private readonly id: string;
    private readonly send: (message: PortTunnelToPage) => void;
    private readonly streams = new Map<number, OpenStream>();
    private next = 1;

    constructor(id: string, send: (message: PortTunnelToPage) => void) {
        this.id = id;
        this.send = send;
    }

    get count(): number {
        return this.streams.size;
    }

    open(events: TunnelStreamEvents): Promise<TunnelStream> {
        if (this.streams.size >= PORT_TUNNEL_MAX_STREAMS) {
            return Promise.reject(new Error('Too many connections are open'));
        }

        const number = this.next++;

        return new Promise<TunnelStream>((resolve, reject) => {
            const stream: OpenStream = {
                events,
                written: 0,
                flushed: 0,
                blocked: false,
                unconsumed: 0,
                opened: false,
                settle: (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome))
            };

            this.streams.set(number, stream);
            this.send({ kind: 'open', id: this.id, stream: number });
        });
    }

    /* A message from the page. Anything that does not fit what the shell asked for is dropped, and a stream it breaks is closed. */
    receive(message: PortTunnelToShell): void {
        if (message.id !== this.id) {
            return;
        }

        const stream = this.streams.get(message.stream);

        if (stream === undefined) {
            return;
        }

        switch (message.kind) {
            case 'opened':
                if (stream.opened) {
                    return;
                }

                if (message.error !== null) {
                    this.streams.delete(message.stream);
                    stream.settle?.(new Error(message.error));
                    stream.settle = null;

                    return;
                }

                stream.opened = true;
                stream.settle?.(this.handle(message.stream, stream));
                stream.settle = null;

                return;
            case 'data': {
                const bytes = message.data;

                if (!stream.opened || !(bytes instanceof Uint8Array) || bytes.byteLength > PORT_TUNNEL_MESSAGE_BYTES) {
                    this.drop(message.stream, 'The machine sent a malformed answer');

                    return;
                }

                stream.unconsumed += bytes.byteLength;

                if (stream.unconsumed > PORT_TUNNEL_WINDOW_BYTES + PORT_TUNNEL_MESSAGE_BYTES) {
                    this.drop(message.stream, 'The machine sent more than the window allowed');

                    return;
                }

                stream.events.data(bytes, () => {
                    if (this.streams.get(message.stream) !== stream) {
                        return;
                    }

                    stream.unconsumed -= bytes.byteLength;
                    this.send({ kind: 'consumed', id: this.id, stream: message.stream, bytes: bytes.byteLength });
                });

                return;
            }
            case 'flushed':
                // Cumulative, so a message that arrives twice or late frees nothing it did not already.
                stream.flushed = Math.min(Math.max(stream.flushed, message.bytes), stream.written);

                if (stream.blocked && stream.written - stream.flushed <= PORT_TUNNEL_WINDOW_BYTES / 2) {
                    stream.blocked = false;
                    stream.events.drain();
                }

                return;
            case 'end':
                this.streams.delete(message.stream);
                stream.events.end(message.reason);

                return;
        }
    }

    /* The tunnel closes: every stream ends here and, for the page, is closed. */
    closeAll(reason: string): void {
        for (const [number, stream] of [...this.streams]) {
            this.streams.delete(number);
            this.send({ kind: 'close', id: this.id, stream: number });

            if (stream.settle !== null) {
                stream.settle(new Error(reason));
            } else {
                stream.events.end(reason);
            }
        }
    }

    private handle(number: number, stream: OpenStream): TunnelStream {
        return {
            write: (bytes) => {
                if (!this.streams.has(number)) {
                    return true;
                }

                for (let at = 0; at < bytes.byteLength; at += PORT_TUNNEL_MESSAGE_BYTES) {
                    const piece = bytes.subarray(at, Math.min(at + PORT_TUNNEL_MESSAGE_BYTES, bytes.byteLength));

                    stream.written += piece.byteLength;
                    this.send({ kind: 'write', id: this.id, stream: number, data: piece });
                }

                if (stream.written - stream.flushed >= PORT_TUNNEL_WINDOW_BYTES) {
                    stream.blocked = true;
                }

                return !stream.blocked;
            },
            closeWrite: () => {
                if (this.streams.has(number)) {
                    this.send({ kind: 'closeWrite', id: this.id, stream: number });
                }
            },
            close: () => {
                if (this.streams.delete(number)) {
                    this.send({ kind: 'close', id: this.id, stream: number });
                }
            }
        };
    }

    private drop(number: number, reason: string): void {
        const stream = this.streams.get(number);

        if (stream === undefined) {
            return;
        }

        this.streams.delete(number);
        this.send({ kind: 'close', id: this.id, stream: number });
        stream.events.end(reason);
    }
}
