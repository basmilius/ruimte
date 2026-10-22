import type { EventMap, PushAttentionEntry, ServerFrame } from '@ruimte/contracts';
import type { ServerWebSocket } from 'bun';
import { OutputGate, type OutputShare } from './backpressure.ts';
import { sendEvent, type ClientAccess, type ClientConnection, type Dispatcher } from './dispatcher.ts';
import { isLiveFrame, type LiveSink } from './client-sinks.ts';
import type { SessionSink } from './sessions/manager.ts';

/* What a connected client needs from whatever carries its frames, a Bun WebSocket or a WebRTC DataChannel. */
export interface ClientChannel {
    // Answers like Bun's `ServerWebSocket.send`: 0 when the frame was dropped, -1 when it was queued under backpressure, else the byte count.
    send(data: string | Uint8Array): number;
    // Bytes written but not yet on the wire; the output gate pauses a client above its high-water mark.
    bufferedAmount(): number;
    close(code: number, reason: string): void;
    // Called once, when the channel is gone for whatever reason.
    onClose(listener: () => void): void;
    // Called when the buffered amount fell back, so the output the gate dropped can be repaired.
    onDrain(listener: () => void): void;
    /* For a channel slower than a terminal can print; without it every frame goes in the order it was sent. */
    readonly outputShare?: OutputShare;
}

interface Subscribable {
    subscribe(clientId: string, sink: SessionSink): () => void;
}

interface Attachable extends Subscribable {
    detachAll(clientId: string): void;
}

interface LiveAttachable {
    subscribe(clientId: string, sink: LiveSink): () => void;
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
        reportPresence?(clientId: string, present: boolean): void;
        observeNotification?(listener: (alert: EventMap['push.notification']) => void): () => void;
        observeAttention?(listener: (entry: PushAttentionEntry) => void): () => void;
    };
    sessions: Attachable & {
        get(sessionId: string): ScreenSource | undefined;
        observeScreens?(clientId: string, listener: (sessionId: string) => void): () => void;
    };
    chats: Attachable;
    browsers?: LiveAttachable;
    /* The pages the clients hold themselves, which the daemon only knows of while they say so. */
    browserPages?: Attachable;
    devices?: LiveAttachable & { requestKeyFrame(backendId: string, deviceId: string): void };
    /* Who has each device an agent operates, which every client hears. */
    deviceControl?: Subscribable;
    identity: Subscribable;
    /* The update of the desktop app on this machine; the install request goes to one client only. */
    updates?: Subscribable;
    projects: Subscribable;
    drawings: Subscribable;
    diagrams: Subscribable;
    launchStore?: Subscribable;
    launches?: Subscribable;
    /* The database sessions a client opened, which close when it goes. */
    databases?: { release(clientId: string): Promise<void> };
    databaseConnections?: Subscribable;
    /* What a person set for the agents of a project's databases, which every client that holds it hears. */
    databaseAgents?: Subscribable;
    language?: Subscribable;
    /* The choices and snapshots of the SQL of a project, which every client that holds it hears. */
    sqlAnalysis?: Subscribable;
    folders: Attachable;
    statuses: Attachable;
    usage: Subscribable;
    limits: Subscribable;
    providerAccounts?: Subscribable;
    /* The provider list, which every client hears again when an agent reported something new about itself. */
    providerList?: Subscribable;
    processes: Subscribable;
    tasks?: Subscribable;
    worktrees?: Subscribable;
    plans?: Subscribable;
    provenance?: Subscribable;
    computer?: Subscribable;
    /* The cards in which agents ask for the secrets of launches, which every client hears. */
    secrets?: Subscribable;
    /* The suggestions of agents in Chats to become a project, which every client hears. */
    proposals?: Subscribable;
    snoozes?: Subscribable;
    prWatches?: Subscribable;
    /* The links of other machines to projects here, which every client hears change. */
    peers?: Subscribable;
    /* Where the links to the machines this one works in stand, which every client hears change. */
    remote?: Subscribable;
    /* The projects another machine's channel held for the tasks it gave, which go with the channel. */
    peerTasks?: { channelClosed(clientId: string): void };
    /* The Voice sessions a client started, which end with its channel: there is no resume. */
    voice?: { channelClosed(clientId: string): void };
    /* How Voice on this machine talks, which every client hears change. */
    voicePreferences?: Subscribable;
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
export function connectionOpener(services: ConnectionServices): (channel: ClientChannel, access: ClientAccess) => OpenConnection {
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
            requestKeyFrame: ({ backendId, deviceId }) => services.devices?.requestKeyFrame(backendId, deviceId),
            share: channel.outputShare
        });
        let closed = false;
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
            }
        };
        const sink: LiveSink = (event) => {
            if (isLiveFrame(event)) {
                gate.sendLive(event);
                return;
            }
            sendEvent(client, event.event, event.payload);
        };
        // Events carry what other clients are doing here; another machine asks for what it needs and hears nothing else.
        const unsubscribes =
            access.peer !== undefined
                ? []
                : [
                      services.presence?.connected(access.sessionId) ?? (() => undefined),
                      () => services.presence?.reportPresence?.(clientId, false),
                      services.presence?.observeAttention?.((entry) => sendEvent(client, 'push.attention', entry)) ?? (() => undefined),
                      services.presence?.observeNotification?.((alert) => sendEvent(client, 'push.notification', alert)) ?? (() => undefined),
                      services.sessions.subscribe(clientId, sink),
                      services.sessions.observeScreens?.(clientId, (sessionId) => gate.screenTaken(sessionId)) ?? (() => undefined),
                      services.chats.subscribe(clientId, sink),
                      services.browsers?.subscribe(clientId, sink) ?? (() => undefined),
                      services.browserPages?.subscribe(clientId, sink) ?? (() => undefined),
                      services.devices?.subscribe(clientId, sink) ?? (() => undefined),
                      services.deviceControl?.subscribe(clientId, sink) ?? (() => undefined),
                      services.identity.subscribe(clientId, sink),
                      services.updates?.subscribe(clientId, sink) ?? (() => undefined),
                      services.projects.subscribe(clientId, sink),
                      services.drawings.subscribe(clientId, sink),
                      services.diagrams.subscribe(clientId, sink),
                      services.launchStore?.subscribe(clientId, sink) ?? (() => undefined),
                      services.launches?.subscribe(clientId, sink) ?? (() => undefined),
                      services.databaseConnections?.subscribe(clientId, sink) ?? (() => undefined),
                      services.databaseAgents?.subscribe(clientId, sink) ?? (() => undefined),
                      services.language?.subscribe(clientId, sink) ?? (() => undefined),
                      services.sqlAnalysis?.subscribe(clientId, sink) ?? (() => undefined),
                      services.folders.subscribe(clientId, sink),
                      services.statuses.subscribe(clientId, sink),
                      services.usage.subscribe(clientId, sink),
                      services.limits.subscribe(clientId, sink),
                      services.providerAccounts?.subscribe(clientId, sink) ?? (() => undefined),
                      services.providerList?.subscribe(clientId, sink) ?? (() => undefined),
                      services.processes.subscribe(clientId, sink),
                      services.tasks?.subscribe(clientId, sink) ?? (() => undefined),
                      services.worktrees?.subscribe(clientId, sink) ?? (() => undefined),
                      services.plans?.subscribe(clientId, sink) ?? (() => undefined),
                      services.provenance?.subscribe(clientId, sink) ?? (() => undefined),
                      services.computer?.subscribe(clientId, sink) ?? (() => undefined),
                      services.secrets?.subscribe(clientId, sink) ?? (() => undefined),
                      services.proposals?.subscribe(clientId, sink) ?? (() => undefined),
                      services.snoozes?.subscribe(clientId, sink) ?? (() => undefined),
                      services.prWatches?.subscribe(clientId, sink) ?? (() => undefined),
                      services.peers?.subscribe(clientId, sink) ?? (() => undefined),
                      services.remote?.subscribe(clientId, sink) ?? (() => undefined),
                      services.voicePreferences?.subscribe(clientId, sink) ?? (() => undefined)
                  ];

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
            if (access.peer !== undefined) {
                services.peerTasks?.channelClosed(clientId);
            } else {
                services.voice?.channelClosed(clientId);
            }
            void services.databases?.release(clientId);
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
