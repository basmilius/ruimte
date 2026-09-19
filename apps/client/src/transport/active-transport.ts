import i18next from 'i18next';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { TransportError, type ConnectionState, type Transport, type TransportStatus } from './transport';

/* What the facade needs of the pool: the socket of one endpoint, and word when any of them changes. */
export interface ActiveSource {
    peek(endpointId: string): Transport | null;
    statusOf(endpointId: string): ConnectionState;
    subscribe(handler: () => void): () => void;
}

export interface ActiveTransportOptions {
    source: ActiveSource;
    activeId(): string;
    /* Word that another machine became the active one. */
    subscribeActive(handler: () => void): () => void;
}

interface Registration {
    event: EventType;
    handler: (payload: never) => void;
    /* How to take this handler off the socket it is on now; null while there is no socket. */
    off: (() => void) | null;
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
            return Promise.reject(new TransportError('not-connected', i18next.t('machines:connection.notConnected')));
        }
        return this.bound.request(type, payload);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const registration: Registration = { event, handler: handler as (payload: never) => void, off: null };
        this.registrations.add(registration);
        if (this.bound) {
            registration.off = this.bound.on(event, handler);
        }
        return () => {
            registration.off?.();
            this.registrations.delete(registration);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
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
            registration.off = next ? this.subscribeOne(next, registration) : null;
        }
        this.bound = next;
        this.announced = null;
        if (next) {
            this.offBoundStatus = next.subscribeStatus(() => this.announce());
        }
    }

    private subscribeOne(target: Transport, registration: Registration): () => void {
        return target.on(registration.event, registration.handler as (payload: EventMap[EventType]) => void);
    }

    /* Only a real change goes out: another machine's socket flapping is not this one's news. */
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
