import type { ServerWebSocket } from 'bun';
import type { EventMap, PushAttentionEntry, ServerFrame } from '@ruimte/contracts';
import { OutputGate, type OutputShare } from './backpressure.ts';
import { isLiveFrame, type LiveSink } from './client-sinks.ts';
import { sendEvent, type ClientAccess, type ClientConnection, type Dispatcher } from './dispatcher.ts';
import type { SessionSink } from './sessions/manager.ts';
import { clientClosed, clientKindOf, clientOpened } from './telemetry/reporter.ts';

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
    extensions?: Subscribable;
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
    activity?: Subscribable;
    prWatches?: Subscribable;
    /* The links of other machines to projects here, which every client hears change. */
    peers?: Subscribable;
    /* Where the links to the machines this one works in stand, which every client hears change. */
    remote?: Subscribable;
    /* The projects another machine's channel held for the tasks it gave, which go with the channel. */
    peerTasks?: { channelClosed(clientId: string): void };
    /* The Voice sessions a client started, which end with its channel: there is no resume. */
    voice?: { channelClosed(clientId: string): void };
    /* The streams of shared ports a client opened, which end with its channel. */
    ports?: { channelClosed(clientId: string): void };
    /* How Voice on this machine talks, which every client hears change. */
    voicePreferences?: Subscribable;
    /* The artifacts of this machine, which only a client that asked with `artifact.watch` hears change. */
    artifacts?: Subscribable;
    /* The routines of this machine, which only a client that asked with `routine.watch` hears change. */
    routines?: Subscribable;
    /* A person's templates, which every client hears change, and a project's, which the clients that hold it hear. */
    templates?: Subscribable;
    /* Tunnels, credentials and the consent of a client that waits, which every client hears change. */
    tunnels?: Subscribable;
    /* The development ports a person shared, which every client hears change. */
    portGrants?: Subscribable;
}

export interface OpenConnection {
    readonly client: ClientConnection;
    // A frame the client sent; ignored once the channel closed.
    receive(message: string | Uint8Array): void;
}

function subscribeClient(services: ConnectionServices, client: ClientConnection, access: ClientAccess, sink: LiveSink, gate: OutputGate): Array<() => void> {
    const { presence, sessions } = services;
    const sources: Array<Subscribable | LiveAttachable | undefined> = [
        services.chats,
        services.browsers,
        services.browserPages,
        services.devices,
        services.deviceControl,
        services.identity,
        services.updates,
        services.projects,
        services.drawings,
        services.diagrams,
        services.launchStore,
        services.launches,
        services.extensions,
        services.databaseConnections,
        services.databaseAgents,
        services.language,
        services.sqlAnalysis,
        services.folders,
        services.statuses,
        services.usage,
        services.limits,
        services.providerAccounts,
        services.providerList,
        services.processes,
        services.tasks,
        services.worktrees,
        services.plans,
        services.provenance,
        services.computer,
        services.secrets,
        services.proposals,
        services.snoozes,
        services.activity,
        services.prWatches,
        services.peers,
        services.remote,
        services.voicePreferences,
        services.artifacts,
        services.routines,
        services.templates,
        services.tunnels,
        services.portGrants
    ];
    const none = (): void => undefined;

    return [
        presence?.connected(access.sessionId) ?? none,
        () => presence?.reportPresence?.(client.id, false),
        presence?.observeAttention?.((entry) => sendEvent(client, 'push.attention', entry)) ?? none,
        presence?.observeNotification?.((alert) => sendEvent(client, 'push.notification', alert)) ?? none,
        sessions.subscribe(client.id, sink),
        sessions.observeScreens?.(client.id, (sessionId) => gate.screenTaken(sessionId)) ?? none,
        ...sources.map((source) => source?.subscribe(client.id, sink) ?? none)
    ];
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
        // Events carry what other clients are doing here; another machine asks for what it needs and hears nothing else.
        const unsubscribes = access.peer !== undefined ? [] : subscribeClient(services, client, access, sink, gate);

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
            // The sessions keep running; only this client's view of them goes.
            for (const source of [
                services.sessions,
                services.chats,
                services.browsers,
                services.browserPages,
                services.devices,
                services.folders,
                services.statuses
            ]) {
                source?.detachAll(clientId);
            }
            if (access.peer !== undefined) {
                services.peerTasks?.channelClosed(clientId);
            } else {
                services.voice?.channelClosed(clientId);
            }
            void services.databases?.release(clientId);
            services.ports?.channelClosed(clientId);
            drainListeners.clear();
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
