import type { PushAttentionEntry, ServerFrame } from '@ruimte/contracts';
import type { ServerWebSocket } from 'bun';
import { OutputGate } from './backpressure.ts';
import { sendEvent, type ClientAccess, type ClientConnection, type Dispatcher } from './dispatcher.ts';
import type { SessionSink } from './sessions/manager.ts';

/*
 * The one thing a connected client needs from whatever carries its frames. A Bun WebSocket is one
 * and a WebRTC DataChannel is meant to be the next, so nothing past this interface knows which.
 */
export interface ClientChannel {
    // Answers like Bun's `ServerWebSocket.send`: 0 when the frame was dropped, -1 when it was queued under backpressure, else the byte count.
    send(data: string): number;
    // Bytes written but not yet on the wire; the output gate pauses a client above its high-water mark.
    bufferedAmount(): number;
    close(code: number, reason: string): void;
    // Called once, when the channel is gone for whatever reason.
    onClose(listener: () => void): void;
    // Called when the buffered amount fell back, so the output the gate dropped can be repaired.
    onDrain(listener: () => void): void;
}

interface Subscribable {
    subscribe(clientId: string, sink: SessionSink): () => void;
}

interface Attachable extends Subscribable {
    detachAll(clientId: string): void;
}

interface ScreenSource {
    isAttached(clientId: string): boolean;
    snapshotFor(clientId: string, onScreen: (screen: string) => void): void;
}

// Structural, so a test can hand in fakes; `daemon.ts` hands in the real managers and stores.
export interface ConnectionServices {
    dispatcher: Pick<Dispatcher, 'handle'>;
    presence?: {
        connected(sessionId: string | null): () => void;
        observeAttention?(listener: (entry: PushAttentionEntry) => void): () => void;
    };
    sessions: Attachable & { get(sessionId: string): ScreenSource | undefined };
    chats: Attachable;
    browsers?: Attachable;
    /* The pages the clients hold themselves, which the daemon only knows of while they say so. */
    browserPages?: Attachable;
    devices?: Attachable & { requestKeyFrame(backendId: string, deviceId: string): void };
    identity: Subscribable;
    projects: Subscribable;
    drawings: Subscribable;
    diagrams: Subscribable;
    folders: Attachable;
    statuses: Attachable;
    usage: Subscribable;
    limits: Subscribable;
    processes: Subscribable;
    tasks?: Subscribable;
    worktrees?: Subscribable;
    plans?: Subscribable;
}

export interface OpenConnection {
    readonly client: ClientConnection;
    // A frame the client sent; ignored once the channel closed.
    receive(message: string | Uint8Array): void;
}

/*
 * Makes a client of every channel that is handed to it: its id, its output gate and every
 * subscription, torn down again when the channel closes. The ids count up per opener, which is one
 * per daemon, so a handler can attach a session to exactly one client whatever carried it in.
 */
export const connectionOpener = (services: ConnectionServices): ((channel: ClientChannel, access: ClientAccess) => OpenConnection) => {
    let nextClientId = 1;

    return (channel, access) => {
        const clientId = `client-${nextClientId++}`;
        const gate = new OutputGate({
            socket: { send: (data) => channel.send(data), getBufferedAmount: () => channel.bufferedAmount() },
            screenOf: (sessionId, deliver) => {
                const session = services.sessions.get(sessionId);
                if (!session?.isAttached(clientId)) {
                    return false;
                }
                session.snapshotFor(clientId, deliver);
                return true;
            },
            requestKeyFrame: ({ backendId, deviceId }) => services.devices?.requestKeyFrame(backendId, deviceId)
        });
        const client: ClientConnection = {
            id: clientId,
            access,
            send(frame: ServerFrame) {
                gate.send(frame);
            }
        };
        const sink: SessionSink = ({ event, payload }) => sendEvent(client, event, payload);
        const unsubscribes = [
            services.presence?.connected(access.sessionId) ?? (() => undefined),
            services.presence?.observeAttention?.((entry) => sendEvent(client, 'push.attention', entry)) ?? (() => undefined),
            services.sessions.subscribe(clientId, sink),
            services.chats.subscribe(clientId, sink),
            services.browsers?.subscribe(clientId, sink) ?? (() => undefined),
            services.browserPages?.subscribe(clientId, sink) ?? (() => undefined),
            services.devices?.subscribe(clientId, sink) ?? (() => undefined),
            services.identity.subscribe(clientId, sink),
            services.projects.subscribe(clientId, sink),
            services.drawings.subscribe(clientId, sink),
            services.diagrams.subscribe(clientId, sink),
            services.folders.subscribe(clientId, sink),
            services.statuses.subscribe(clientId, sink),
            services.usage.subscribe(clientId, sink),
            services.limits.subscribe(clientId, sink),
            services.processes.subscribe(clientId, sink),
            services.tasks?.subscribe(clientId, sink) ?? (() => undefined),
            services.worktrees?.subscribe(clientId, sink) ?? (() => undefined),
            services.plans?.subscribe(clientId, sink) ?? (() => undefined)
        ];
        let closed = false;

        channel.onDrain(() => {
            if (!closed) {
                gate.onDrain();
            }
        });
        channel.onClose(() => {
            if (closed) {
                return;
            }
            closed = true;
            // The sessions keep running; only this client's view of them goes.
            services.sessions.detachAll(clientId);
            services.chats.detachAll(clientId);
            services.browsers?.detachAll(clientId);
            services.browserPages?.detachAll(clientId);
            services.devices?.detachAll(clientId);
            services.folders.detachAll(clientId);
            services.statuses.detachAll(clientId);
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
                void services.dispatcher.handle(client, message);
            }
        };
    };
};

// A Bun WebSocket as a channel; its `close` and `drain` arrive on the server's handlers, which pass them on here.
export interface SocketChannel extends ClientChannel {
    closed(): void;
    drained(): void;
}

export const socketChannel = (ws: ServerWebSocket<ClientAccess>): SocketChannel => {
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
};
