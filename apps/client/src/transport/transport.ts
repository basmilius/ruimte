import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';

export type TransportStatus = 'connecting' | 'open' | 'closed';

export interface ConnectionState {
    status: TransportStatus;
    /* Reconnects tried since the last open socket; 0 while connected. */
    attempts: number;
    /* When the next reconnect fires, epoch ms, or null when none is waiting. */
    retryAt: number | null;
}

export interface Transport {
    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']>;
    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void;
    readonly status: TransportStatus;
    /* The status plus the reconnect loop behind it. A transport without a loop leaves this out;
       the object identity only changes when the state does, so a store can read it as a snapshot. */
    readonly connection?: ConnectionState;
    subscribeStatus(handler: (status: TransportStatus) => void): () => void;
    /* Reconnects to another daemon. */
    switchTo?(url: string): void;
}

// A rejected request always carries a code, so callers can branch without parsing messages.
export class TransportError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'TransportError';
        this.code = code;
    }
}
