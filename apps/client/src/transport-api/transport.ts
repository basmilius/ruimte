import type { BytesReadPayload, EventMap, EventType, LiveFrameEvent, LiveFrameHeader, RequestMap, RequestType } from '@ruimte/contracts';
import type { BytesPiece } from './piece';

export type TransportStatus = 'connecting' | 'open' | 'closed';

/* The way the offer and answer of a direct connection travelled: the machine's door on the local network, or the broker. */
export type SignalRoute = 'lan' | 'broker';

export interface ConnectionState {
    status: TransportStatus;
    /* Reconnects tried since the last open socket; 0 while connected. */
    attempts: number;
    /* When the next reconnect fires, epoch ms, or null when none is waiting. */
    retryAt: number | null;
    /* Why the last connection failed, when that is worth telling a person (a direct connection that did not come up); cleared on open. */
    failure?: string | null;
    /* Set when this client has no link to the machine at all, which is a machine nobody is using rather than one that failed. */
    noLink?: boolean;
    /* True while an open direct connection runs through a TURN relay rather than straight to the machine. */
    relayed?: boolean;
    /* How the open direct connection was signaled; null over a socket, and for the row of this machine, whose signals go over its own socket. */
    signaled?: SignalRoute | null;
    /* What the machine answered at open, the requests it handles (`endpoint.info`); absent before the first open. */
    features?: readonly string[];
}

export type LiveFrameHandler<E extends LiveFrameEvent> = (header: LiveFrameHeader<E>, bytes: Uint8Array) => void;

export interface Transport {
    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']>;
    /* `bytes.read` answered as a binary reply, by a transport that reads those; see `readPiece`. */
    readBytes?(payload: BytesReadPayload): Promise<BytesPiece>;
    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void;
    /* The frames of a stream opened with `binary`, by a transport that reads those; without it a client asks for JSON. */
    onLiveFrame?<E extends LiveFrameEvent>(event: E, handler: LiveFrameHandler<E>): () => void;
    readonly status: TransportStatus;
    /* The status plus the reconnect loop behind it. A transport without a loop leaves this out;
       the object identity only changes when the state does, so a store can read it as a snapshot. */
    readonly connection?: ConnectionState;
    subscribeStatus(handler: (status: TransportStatus) => void): () => void;
}

// A rejected request always carries a code, so callers can branch without parsing messages.
export class TransportError extends Error {
    readonly code: string;
    readonly request?: RequestType;

    /* `cause` is where the request was asked: a reply settles it from the socket's handler, so the
       error's own stack never names the caller that left it unhandled. */
    constructor(code: string, message: string, options?: { request?: RequestType; cause?: Error }) {
        super(message, options?.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'TransportError';
        this.code = code;

        if (options?.request !== undefined) {
            this.request = options.request;
        }
    }
}

/*
 * Whether a request failed because the link was down rather than because the machine refused it.
 * Only the transport throws these two, so only the transport gets to say which they are. A client
 * that asked while the socket was gone waits for the reconnect and asks again, and tells nobody.
 */
export function isConnectionError(error: unknown): boolean {
    return error instanceof TransportError && (error.code === 'not-connected' || error.code === 'disconnected');
}

/*
 * The one door for a request whose failure nobody needs: a release, an unsubscribe, a note to the machine.
 * A request is either awaited and its failure shown, or goes through here, which never rejects. A failure
 * is logged at debug level and dropped, except one of the link, since the reconnect asks again and there
 * is nothing to say.
 */
export function fireAndForget(what: string, request: PromiseLike<unknown> | undefined): Promise<void> {
    return Promise.resolve(request).then(
        () => undefined,
        (error: unknown) => {
            if (!isConnectionError(error)) {
                console.debug(`[request] ${what} failed and was dropped`, error);
            }
        }
    );
}

/* The same for a read whose failure is an answer of its own: nothing, under the same logging. */
export function orNull<T>(what: string, request: PromiseLike<T> | undefined): Promise<T | null> {
    return Promise.resolve(request).then(
        (value) => value ?? null,
        (error: unknown) => {
            if (!isConnectionError(error)) {
                console.debug(`[request] ${what} failed and was read as nothing`, error);
            }

            return null;
        }
    );
}

/*
 * Runs `read` now if the link is open and again on every open after, since what changed while it was
 * closed was told to nobody. `onStatus` runs first on every change of status.
 */
export function readOnEveryOpen(transport: Transport, read: () => void, onStatus?: () => void): () => void {
    const off = transport.subscribeStatus((status) => {
        onStatus?.();
        if (status === 'open') {
            read();
        }
    });
    if (transport.status === 'open') {
        read();
    }
    return off;
}
