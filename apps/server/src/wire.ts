import type { EventMap, EventType, ServerFrame } from '@ruimte/contracts';

export type SessionEvent = { [E in EventType]: { event: E; payload: EventMap[E] } }[EventType];

export type SessionSink = (event: SessionEvent) => void;

export interface ClientAccess {
    reachability: 'loopback' | 'lan' | 'tunnel' | 'public';
    // The session behind the socket; null for a client that presented the local secret.
    sessionId: string | null;
    /* Set when the client is another machine of the account that works here, not a person. It asks for the requests on the peer list and nothing else. */
    peer?: { machineId: string };
}

export interface ClientConnection {
    // Unique per socket for the life of the daemon, so a handler can attach a session to exactly this client.
    readonly id: string;
    readonly access?: ClientAccess;
    /* True once the channel went. Its cleanup already ran, so state a handler leaves for it after an await would outlive it. */
    readonly closed?: boolean;
    send(frame: ServerFrame): void;
    // A channel that carries binary frames; a reply that asked for one goes out this way.
    sendBinary?(frame: Uint8Array): void;
}

export function sendEvent<E extends EventType>(client: ClientConnection, event: E, payload: EventMap[E]): void {
    client.send({ type: 'event', event, payload });
}
