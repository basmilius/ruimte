import type { EventMap, EventType, ServerFrame } from '@ruimte/contracts';
import type { OutputShare } from './backpressure.ts';

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
    /* Bytes the channel holds that are not on the wire yet, for bulk data that must wait rather than fill it. Without it a client takes any frame. */
    bufferedAmount?(): number;
    /* Calls `listener` whenever the channel drained; returns the way to stop. */
    onDrain?(listener: () => void): () => void;
}

export function sendEvent<E extends EventType>(client: ClientConnection, event: E, payload: EventMap[E]): void {
    client.send({ type: 'event', event, payload });
}

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
