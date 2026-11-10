import type { PortTunnelToPage, PortTunnelToShell } from '@ruimte/desktop-bridge';
import { PortStreamHub, type PortStreamClient } from './stream-client';

interface TunnelShell {
    onPortTunnel(listener: (message: PortTunnelToPage) => void): () => void;
    portTunnelSend(message: PortTunnelToShell): void;
}

interface Held {
    client: PortStreamClient | null;
    /* What arrived before the shell heard that the stream opened, in order. */
    early: PortTunnelToShell[];
    ready: boolean;
}

/*
 * The page's end of a tunnel: the shell asks for streams, bytes and closes, and this holds them against
 * the machine connection. A stream's answer is only passed to the shell after the shell was told the stream
 * opened, since the shell takes nothing from a stream it does not know yet.
 */
export class PortTunnelHost {
    private readonly id: string;
    private readonly grantId: string;
    private readonly shell: TunnelShell;
    private readonly hub: PortStreamHub;
    private readonly streams = new Map<number, Held>();
    private stop: (() => void) | null = null;

    constructor(options: { id: string; grantId: string; shell: TunnelShell; hub: PortStreamHub }) {
        this.id = options.id;
        this.grantId = options.grantId;
        this.shell = options.shell;
        this.hub = options.hub;
    }

    get count(): number {
        return this.streams.size;
    }

    start(): void {
        this.stop = this.shell.onPortTunnel((message) => {
            if (message.id === this.id) {
                this.handle(message);
            }
        });
    }

    dispose(reason: string): void {
        this.stop?.();
        this.stop = null;

        for (const held of this.streams.values()) {
            held.client?.close();
        }

        this.streams.clear();
        this.hub.dispose(reason);
    }

    private handle(message: PortTunnelToPage): void {
        switch (message.kind) {
            case 'open':
                this.open(message.stream);

                return;
            case 'write':
                this.streams.get(message.stream)?.client?.write(message.data);

                return;
            case 'consumed':
                this.streams.get(message.stream)?.client?.consumed(message.bytes);

                return;
            case 'closeWrite':
                this.streams.get(message.stream)?.client?.closeWrite();

                return;
            case 'close':
                this.streams.get(message.stream)?.client?.close();
                this.streams.delete(message.stream);

                return;
        }
    }

    private open(number: number): void {
        const held: Held = { client: null, early: [], ready: false };
        const tell = (message: PortTunnelToShell): void => {
            if (held.ready) {
                this.shell.portTunnelSend(message);
            } else {
                held.early.push(message);
            }
        };

        this.streams.set(number, held);
        this.hub
            .open(this.grantId, {
                data: (data) => tell({ kind: 'data', id: this.id, stream: number, data }),
                flushed: (bytes) => tell({ kind: 'flushed', id: this.id, stream: number, bytes }),
                end: (reason) => {
                    tell({ kind: 'end', id: this.id, stream: number, reason });
                    this.streams.delete(number);
                }
            })
            .then(
                (client) => {
                    held.client = client;
                    held.ready = true;
                    this.shell.portTunnelSend({ kind: 'opened', id: this.id, stream: number, error: null });

                    for (const early of held.early.splice(0)) {
                        this.shell.portTunnelSend(early);
                    }
                },
                (e: unknown) => {
                    this.streams.delete(number);
                    this.shell.portTunnelSend({
                        kind: 'opened',
                        id: this.id,
                        stream: number,
                        error: e instanceof Error ? e.message : 'The machine did not open the stream'
                    });
                }
            );
    }
}
