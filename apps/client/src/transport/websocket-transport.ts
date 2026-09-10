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
import { TransportError, type ConnectionState, type Transport, type TransportStatus } from './transport';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

interface Pending {
    type: RequestType;
    resolve(result: unknown): void;
    reject(error: TransportError): void;
}

export class WebSocketTransport implements Transport {
    private socket: WebSocket | null = null;
    private currentConnection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null };
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly pending = new Map<string, Pending>();
    private nextId = 1;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private url: string;

    constructor(url: string) {
        this.url = url;
        this.connect();
    }

    get status(): TransportStatus {
        return this.currentConnection.status;
    }

    get connection(): ConnectionState {
        return this.currentConnection;
    }

    get address(): string {
        return this.url;
    }

    /* Points the transport at another daemon; the socket closes and comes back on the new address. */
    switchTo(url: string): void {
        if (url === this.url) {
            return;
        }
        this.url = url;
        this.setConnection({ attempts: 0, retryAt: null });
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const socket = this.socket;
        if (socket) {
            // Closing runs the normal close path, which reconnects on the address set above.
            socket.close();
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
        if (this.status !== 'open' || !this.socket) {
            return Promise.reject(new TransportError('not-connected', 'The server is not connected'));
        }
        const id = String(this.nextId++);
        const promise = new Promise<RequestMap[T]['result']>((resolve, reject) => {
            this.pending.set(id, { type, resolve: resolve as (result: unknown) => void, reject });
        });
        this.socket.send(JSON.stringify({ id, type, payload }));
        return promise;
    }

    // Stops reconnecting for good; used when the module that owns the transport is torn down.
    dispose(): void {
        this.disposed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.socket?.close();
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
        const socket = new WebSocket(this.url);
        this.socket = socket;

        socket.onopen = () => {
            this.setConnection({ status: 'open', attempts: 0, retryAt: null });
        };
        socket.onmessage = (message) => {
            this.receive(String(message.data));
        };
        socket.onclose = () => {
            if (this.socket !== socket) {
                return;
            }
            this.socket = null;
            // Scheduling first, so the closed status arrives with the attempt it announces.
            this.scheduleReconnect();
            this.setConnection({ status: 'closed' });
            this.rejectPending('disconnected', 'The connection closed before the server answered');
        };
        // The browser fires close right after error, so close owns the state change.
        socket.onerror = () => {};
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
