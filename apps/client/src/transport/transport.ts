import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';

export type TransportStatus = 'connecting' | 'open' | 'closed';

export interface Transport {
    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']>;
    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void;
    readonly status: TransportStatus;
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
