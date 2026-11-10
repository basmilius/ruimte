import type { ServerWebSocket } from 'bun';
import type { ServerFrame } from '@ruimte/contracts';
import type { Area, ClientEnd } from './area.ts';
import { OutputGate } from './backpressure.ts';
import { isLiveFrame, type LiveSink } from './client-sinks.ts';
import { type Dispatcher } from './dispatcher.ts';
import { clientClosed, clientKindOf, clientOpened } from './telemetry/reporter.ts';
import { sendEvent, type ClientAccess, type ClientChannel, type ClientConnection } from './wire.ts';

/* What the opener needs besides the areas: the dispatcher a frame goes to, and the two things an output gate asks of the daemon. */
export interface ConnectionHost {
    dispatcher: Pick<Dispatcher, 'handle'>;
    areas: readonly Area[];
    /* Hands a client the screen of a session it attached, or says it has none there. */
    screenOf(clientId: string, sessionId: string, deliver: (screen: string) => void): boolean;
    requestKeyFrame(backendId: string, deviceId: string): void;
}

export interface OpenConnection {
    readonly client: ClientConnection;
    // A frame the client sent; ignored once the channel closed.
    receive(message: string | Uint8Array): void;
}

function subscribeClient(areas: readonly Area[], end: ClientEnd): Array<() => void> {
    return areas.flatMap((area) => [...(area.sources ?? []).map((source) => source.subscribe(end.client.id, end.sink)), ...(area.connect?.(end) ?? [])]);
}

/*
 * Makes a client of every channel that is handed to it: its id, its output gate and every
 * subscription, torn down again when the channel closes. The ids count up per opener, which is one
 * per daemon, so a handler can attach a session to exactly one client whatever carried it in.
 */
export function connectionOpener(host: ConnectionHost): (channel: ClientChannel, access: ClientAccess) => OpenConnection {
    let nextClientId = 1;

    return (channel, access) => {
        const clientId = `client-${nextClientId++}`;
        const gate = new OutputGate({
            socket: { send: (data) => channel.send(data), getBufferedAmount: () => channel.bufferedAmount() },
            screenOf: (sessionId, deliver) => host.screenOf(clientId, sessionId, deliver),
            requestKeyFrame: ({ backendId, deviceId }) => host.requestKeyFrame(backendId, deviceId),
            share: channel.outputShare
        });
        let closed = false;
        const drainListeners = new Set<() => void>();
        const client: ClientConnection = {
            id: clientId,
            access,
            get closed() {
                return closed;
            },
            send(frame: ServerFrame) {
                gate.send(frame);
            },
            sendBinary(frame: Uint8Array) {
                gate.sendBinary(frame);
            },
            bufferedAmount: () => channel.bufferedAmount(),
            onDrain(listener) {
                drainListeners.add(listener);

                return () => {
                    drainListeners.delete(listener);
                };
            }
        };
        const sink: LiveSink = (event) => {
            if (isLiveFrame(event)) {
                gate.sendLive(event);
                return;
            }
            sendEvent(client, event.event, event.payload);
        };

        const kind = clientKindOf(access);
        clientOpened(kind);
        for (const area of host.areas) {
            area.opened?.(clientId, access);
        }
        // Events carry what other clients are doing here; another machine asks for what it needs and hears nothing else.
        const unsubscribes = access.peer !== undefined ? [] : subscribeClient(host.areas, { client, access, sink, gate });

        channel.onDrain(() => {
            if (!closed) {
                gate.onDrain();

                for (const listener of [...drainListeners]) {
                    listener();
                }
            }
        });
        channel.onClose(() => {
            if (closed) {
                return;
            }
            closed = true;
            clientClosed(kind);
            drainListeners.clear();
            // The sessions keep running; only this client's view of them goes.
            for (const area of host.areas) {
                for (const holder of area.holders ?? []) {
                    holder.detachAll(clientId);
                }
                void area.closed?.(clientId, access);
            }
            for (const unsubscribe of unsubscribes) {
                unsubscribe();
            }
        });

        return {
            client,
            receive(message) {
                if (closed) {
                    return;
                }
                void host.dispatcher.handle(client, message);
            }
        };
    };
}

// A Bun WebSocket as a channel; its `close` and `drain` arrive on the server's handlers, which pass them on here.
export interface SocketChannel extends ClientChannel {
    closed(): void;
    drained(): void;
}

export function socketChannel(ws: ServerWebSocket<ClientAccess>): SocketChannel {
    const closeListeners: Array<() => void> = [];
    const drainListeners: Array<() => void> = [];
    return {
        send: (data) => ws.send(data),
        bufferedAmount: () => ws.getBufferedAmount(),
        close: (code, reason) => ws.close(code, reason),
        onClose: (listener) => {
            closeListeners.push(listener);
        },
        onDrain: (listener) => {
            drainListeners.push(listener);
        },
        closed: () => {
            for (const listener of closeListeners) {
                listener();
            }
        },
        drained: () => {
            for (const listener of drainListeners) {
                listener();
            }
        }
    };
}
