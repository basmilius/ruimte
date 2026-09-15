import { DirectSignalPayloadSchema, type DirectSignalPayload } from '@ruimte/contracts';
import type { IceServer } from '@ruimte/pulsar';

export type Signal = DirectSignalPayload['envelope']['signal'];

export interface SignalingEvents {
    /* Signals can go out from here; `iceServers` are what the route hands out for this attempt (TURN credentials from the broker), none over a socket. */
    ready(iceServers?: IceServer[]): void;
    /* A signal from the machine for this attempt. */
    signal(signal: Signal): void;
    /* The way the signals travel is gone, with a sentence for the machine's row. */
    fail(reason: string): void;
}

export interface Signaling {
    send(signal: Signal): void;
    /* Ends this attempt's part in it; no event fires after. */
    close(): void;
}

/*
 * The way one attempt's offer and answer travel. A direct connection only needs them delivered and
 * knows nothing else about the route: a socket to the machine itself, or the broker.
 */
export type SignalingOpener = (connectionId: string, events: SignalingEvents) => Signaling;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/*
 * The signals over a socket to the machine: `direct.signal` one way and `direct.signaled` the other.
 * The address is the socket URL the transport resolved for this attempt, ticket and all.
 */
export const socketSignaling =
    (url: string, createSocket: (url: string) => WebSocket = (address) => new WebSocket(address)): SignalingOpener =>
    (connectionId, events) => {
        let socket: WebSocket | null = null;
        let nextSignal = 1;
        let done = false;

        const detach = (): void => {
            if (!socket) {
                return;
            }
            socket.onclose = null;
            socket.onmessage = null;
            socket.onopen = null;
            socket.close();
            socket = null;
        };

        const fail = (reason: string): void => {
            if (done) {
                return;
            }
            done = true;
            detach();
            events.fail(reason);
        };

        const onFrame = (raw: string): void => {
            let frame: { id?: unknown; ok?: unknown; error?: { message?: string }; type?: unknown; event?: unknown; payload?: unknown };
            try {
                frame = JSON.parse(raw) as typeof frame;
            } catch {
                return;
            }
            if (typeof frame.id === 'string' && frame.id.startsWith('direct-') && frame.ok === false) {
                // A daemon from before direct connections answers `unknown-request`, which is worth saying in so many words.
                fail(`The machine did not take the direct connection: ${frame.error?.message ?? 'no reason given'}`);
                return;
            }
            if (frame.type !== 'event' || frame.event !== 'direct.signaled') {
                return;
            }
            const parsed = DirectSignalPayloadSchema.safeParse(frame.payload);
            if (parsed.success && parsed.data.envelope.connectionId === connectionId) {
                events.signal(parsed.data.envelope.signal);
            }
        };

        try {
            socket = createSocket(url);
        } catch (e) {
            fail(`The machine could not be reached to set up a direct connection: ${messageOf(e)}`);
            return { send: () => undefined, close: () => undefined };
        }
        socket.onopen = () => events.ready();
        socket.onmessage = (message) => onFrame(String(message.data));
        socket.onclose = () => fail('The machine could not be reached to set up a direct connection');
        socket.onerror = () => {};

        return {
            send: (signal) => {
                socket?.send(JSON.stringify({ id: `direct-${nextSignal++}`, type: 'direct.signal', payload: { envelope: { connectionId, signal } } }));
            },
            close: () => {
                done = true;
                detach();
            }
        };
    };
