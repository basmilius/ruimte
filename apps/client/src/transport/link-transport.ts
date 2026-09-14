import {
    EVENT_SCHEMAS,
    REQUEST_SCHEMAS,
    isEventType,
    parseServerFrame,
    type EventMap,
    type EventType,
    type RequestMap,
    type RequestType
} from '@ruimte/contracts';
import type { PooledTransport } from './pool';
import { TransportError, type ConnectionState, type TransportStatus } from './transport';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/* Where the next connection opens. A function, because the address carries a credential that is signed for per connection. */
export type SocketAddress = string | (() => Promise<string>);

/* One connection to a daemon, whatever carries it: a WebSocket, or a DataChannel with the handshake run on it. */
export interface Link {
    send(data: string): void;
    /* Ends the link; its `close` event still fires, once. */
    close(): void;
}

export interface LinkEvents {
    open(): void;
    message(data: string): void;
    /* The link is gone. `failure` says why when that is worth showing a person; null for an ordinary close. */
    close(failure: string | null): void;
}

/* Opens a link on an address the transport resolved for this attempt. */
export type LinkOpener = (url: string, events: LinkEvents) => Link;

interface Pending {
    type: RequestType;
    resolve(result: unknown): void;
    reject(error: TransportError): void;
}

/*
 * A daemon's wire: requests with ids, events, and a reconnect loop, over whatever link the opener
 * hands back for each attempt. The loop, the pending requests and the event handlers belong to the
 * transport, so a link that is replaced (a reconnect, or a machine switched to or from a direct
 * connection) leaves every client built on this transport where it was.
 */
export class LinkTransport implements PooledTransport {
    private link: Link | null = null;
    // Which link the events belong to; a link that was replaced may still report, and nobody listens to it.
    private linkToken: object | null = null;
    private currentConnection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null, failure: null };
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly pending = new Map<string, Pending>();
    private readonly openLink: LinkOpener;
    private nextId = 1;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private address: SocketAddress;
    // Bumped by anything that makes an attempt stale, so an address resolved slowly cannot open a link nobody wants.
    private generation = 0;

    constructor(address: SocketAddress, openLink: LinkOpener) {
        this.address = address;
        this.openLink = openLink;
        this.connect();
    }

    get status(): TransportStatus {
        return this.currentConnection.status;
    }

    get connection(): ConnectionState {
        return this.currentConnection;
    }

    /*
     * Says where the next connection goes without touching the one that is open. What a socket that
     * moved to another endpoint id needs: the machine did not change, only what this client calls it,
     * and closing would drop every session attached to it.
     */
    retarget(address: SocketAddress): void {
        this.address = address;
    }

    /* Points the transport at another address of the same daemon; it closes and comes back there. */
    switchTo(address: SocketAddress): void {
        if (address === this.address) {
            return;
        }
        this.address = address;
        this.reconnect();
    }

    /* Drops the link and opens a new one straight away, on whatever the opener picks now. */
    reconnect(): void {
        if (this.disposed) {
            return;
        }
        this.generation += 1;
        this.setConnection({ attempts: 0, retryAt: null, failure: null });
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const link = this.link;
        if (link) {
            // Closing runs the normal close path, which reconnects on the address set above.
            link.close();
        } else {
            this.connect();
        }
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
        };
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (this.status !== 'open' || !this.link) {
            return Promise.reject(new TransportError('not-connected', 'The machine is not connected'));
        }
        const id = String(this.nextId++);
        const promise = new Promise<RequestMap[T]['result']>((resolve, reject) => {
            this.pending.set(id, { type, resolve: resolve as (result: unknown) => void, reject });
        });
        this.link.send(JSON.stringify({ id, type, payload }));
        return promise;
    }

    // Stops reconnecting for good; used when the module that owns the transport is torn down.
    dispose(): void {
        this.disposed = true;
        this.generation += 1;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.link?.close();
    }

    /* Every reconnect field moves in the same tick as the status it belongs to, so a subscriber
       that hears the status has the attempt count and the countdown that go with it. */
    private setConnection(next: Partial<ConnectionState>): void {
        const merged = { ...this.currentConnection, ...next };
        const changed = this.currentConnection.status !== merged.status;
        this.currentConnection = merged;
        if (!changed) {
            return;
        }
        for (const handler of this.statusHandlers) {
            handler(merged.status);
        }
    }

    private connect(): void {
        if (this.disposed) {
            return;
        }
        this.setConnection({ status: 'connecting', retryAt: null });
        const generation = this.generation;
        const resolved = typeof this.address === 'string' ? Promise.resolve(this.address) : this.address();
        void resolved.then(
            (url) => {
                if (generation === this.generation && !this.disposed) {
                    this.open(url);
                }
            },
            (e) => {
                if (generation !== this.generation || this.disposed) {
                    return;
                }
                // A daemon that will not say how to reach it is a daemon that is not reachable; the backoff is the same one.
                console.warn('Could not work out how to connect', e);
                this.scheduleReconnect();
                this.setConnection({ status: 'closed' });
            }
        );
    }

    private open(url: string): void {
        const token = {};
        this.linkToken = token;
        const link = this.openLink(url, {
            open: () => {
                if (this.linkToken === token) {
                    this.setConnection({ status: 'open', attempts: 0, retryAt: null, failure: null });
                }
            },
            message: (data) => {
                if (this.linkToken === token) {
                    this.receive(data);
                }
            },
            close: (failure) => {
                if (this.linkToken !== token) {
                    return;
                }
                this.linkToken = null;
                this.link = null;
                // Scheduling first, so the closed status arrives with the attempt it announces.
                this.scheduleReconnect();
                this.setConnection({ status: 'closed', failure });
                this.rejectPending('disconnected', 'The connection closed before the machine answered');
            }
        });
        // A link that failed while it was being opened already reported, and is no link to keep.
        if (this.linkToken === token) {
            this.link = link;
        }
    }

    private scheduleReconnect(): void {
        if (this.disposed || this.reconnectTimer) {
            return;
        }
        const delay = Math.min(RECONNECT_MIN_MS * 2 ** this.currentConnection.attempts, RECONNECT_MAX_MS);
        this.setConnection({ attempts: this.currentConnection.attempts + 1, retryAt: Date.now() + delay });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private rejectPending(code: string, message: string): void {
        const entries = [...this.pending.values()];
        this.pending.clear();
        for (const entry of entries) {
            entry.reject(new TransportError(code, message));
        }
    }

    private receive(raw: string): void {
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            console.warn('Dropped a server frame that is not JSON');
            return;
        }
        const parsed = parseServerFrame(json);
        if (!parsed.ok) {
            console.warn('Dropped a malformed server frame', parsed.message);
            return;
        }
        const frame = parsed.value;
        if ('event' in frame) {
            this.dispatchEvent(frame.event, frame.payload);
            return;
        }
        const { id } = frame;
        if (id === null) {
            // A reply without an id answers a frame the server could not read; nothing waits for it.
            console.warn('Server refused a frame', frame);
            return;
        }
        const entry = this.pending.get(id);
        if (!entry) {
            return;
        }
        this.pending.delete(id);
        if (!frame.ok) {
            entry.reject(new TransportError(frame.error.code, frame.error.message));
            return;
        }
        const result = REQUEST_SCHEMAS[entry.type].result.safeParse(frame.result);
        if (!result.success) {
            entry.reject(new TransportError('bad-reply', `The reply to ${entry.type} does not match its contract`));
            return;
        }
        entry.resolve(result.data);
    }

    private dispatchEvent(event: string, payload: unknown): void {
        if (!isEventType(event)) {
            console.warn('Dropped an unknown event', event);
            return;
        }
        const parsed = EVENT_SCHEMAS[event].safeParse(payload);
        if (!parsed.success) {
            console.warn(`Dropped a malformed ${event} event`);
            return;
        }
        const handlers = this.eventHandlers.get(event);
        if (!handlers) {
            return;
        }
        for (const handler of handlers) {
            (handler as (payload: unknown) => void)(parsed.data);
        }
    }
}
