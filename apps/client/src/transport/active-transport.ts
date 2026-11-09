import type { BytesReadPayload, EventMap, EventType, LiveFrameEvent, RequestMap, RequestType } from '@ruimte/contracts';
import i18next from 'i18next';
import { readPiece, type BytesPiece } from '../transport-api/piece';
import { TransportError, type ConnectionState, type LiveFrameHandler, type Transport, type TransportStatus } from '../transport-api/transport';

/* What the facade needs of the pool: the socket of one endpoint, and word when any of them changes. */
export interface ActiveSource {
    peek(endpointId: string): Transport | null;
    statusOf(endpointId: string): ConnectionState;
    subscribe(handler: () => void): () => void;
}

interface ActiveTransportOptions {
    source: ActiveSource;
    activeId(): string;
    subscribeActive(handler: () => void): () => void;
}

interface Registration {
    bind(transport: Transport): () => void;
    /* How to take this handler off the socket it is on now; null while there is no socket. */
    off: (() => void) | null;
}

/*
 * The standing lists that more than one client of a machine asks a fresh socket for (the chats, the
 * sessions, the sidebar). A list asked while the same list is on its way on that socket rides on it:
 * the machine answers a list in the step it reads the request and every frame arrives in order, so the
 * answer still to come holds everything the second asker has heard by then.
 */
const SHARED_IN_FLIGHT: ReadonlySet<RequestType> = new Set<RequestType>(['session.list', 'chat.list']);

/* Per socket rather than per facade: the active machine's facade and that machine's own are two over one socket. */
const inFlight = new WeakMap<Transport, Map<RequestType, Promise<unknown>>>();

function sharedRequest<T extends RequestType>(socket: Transport, type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
    let lists = inFlight.get(socket);
    if (!lists) {
        lists = new Map();
        inFlight.set(socket, lists);
    }
    const known = lists.get(type);
    if (known) {
        return known as Promise<RequestMap[T]['result']>;
    }
    const answer = socket.request(type, payload);
    const settled = (): void => {
        if (lists.get(type) === answer) {
            lists.delete(type);
        }
    };
    lists.set(type, answer);
    answer.then(settled, settled);
    return answer;
}

function notConnected(): Promise<never> {
    return Promise.reject(new TransportError('not-connected', i18next.t('machines:connection.notConnected')));
}

/*
 * Event handlers follow the active machine immediately. In-flight requests remain bound to the
 * socket that sent them, so callers must reject stale answers after a machine switch.
 */
export class ActiveTransport implements Transport {
    private readonly source: ActiveSource;
    private readonly activeId: () => string;
    private readonly registrations = new Set<Registration>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private bound: Transport | null = null;
    private offBoundStatus: (() => void) | null = null;
    // Null right after a rebind, so the first word about a new socket always goes out.
    private announced: TransportStatus | null = null;

    constructor(options: ActiveTransportOptions) {
        this.source = options.source;
        this.activeId = options.activeId;
        options.source.subscribe(() => this.sync());
        options.subscribeActive(() => this.sync());
        this.sync();
    }

    get status(): TransportStatus {
        return this.source.statusOf(this.activeId()).status;
    }

    get connection(): ConnectionState {
        return this.source.statusOf(this.activeId());
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (!this.bound) {
            return notConnected();
        }
        return SHARED_IN_FLIGHT.has(type) ? sharedRequest(this.bound, type, payload) : this.bound.request(type, payload);
    }

    readBytes(payload: BytesReadPayload): Promise<BytesPiece> {
        if (!this.bound) {
            return notConnected();
        }
        return readPiece(this.bound, payload);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        return this.register((transport) => transport.on(event, handler));
    }

    onLiveFrame<E extends LiveFrameEvent>(event: E, handler: LiveFrameHandler<E>): () => void {
        return this.register((transport) => transport.onLiveFrame?.(event, handler) ?? (() => undefined));
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    private register(bind: Registration['bind']): () => void {
        const registration: Registration = { bind, off: this.bound ? bind(this.bound) : null };
        this.registrations.add(registration);
        return () => {
            registration.off?.();
            this.registrations.delete(registration);
        };
    }

    private sync(): void {
        const next = this.source.peek(this.activeId());
        if (next !== this.bound) {
            this.rebind(next);
        }
        this.announce();
    }

    private rebind(next: Transport | null): void {
        this.offBoundStatus?.();
        this.offBoundStatus = null;
        for (const registration of this.registrations) {
            registration.off?.();
            registration.off = next ? registration.bind(next) : null;
        }
        this.bound = next;
        this.announced = null;
        if (next) {
            this.offBoundStatus = next.subscribeStatus(() => this.announce());
        }
    }

    /* Only a real change goes out. Another machine's socket flapping is not this one's news. */
    private announce(): void {
        const status = this.status;
        if (status === this.announced) {
            return;
        }
        this.announced = status;
        for (const handler of [...this.statusHandlers]) {
            handler(status);
        }
    }
}
