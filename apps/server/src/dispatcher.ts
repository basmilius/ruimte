import { errorText } from './error-text.ts';
import {
    REQUEST_SCHEMAS,
    isRequestType,
    parseRequest,
    type EventMap,
    type EventType,
    type ReplyError,
    type RequestMap,
    type RequestType,
    type ServerFrame
} from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';

export interface ClientAccess {
    reachability: 'loopback' | 'lan' | 'tunnel' | 'public';
    // The session behind the socket; null for a client that presented the local secret.
    sessionId: string | null;
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

/* A result that goes out as one binary frame, which only a handler whose client has `sendBinary` hands back. */
export class BinaryReply {
    readonly encode: (id: string) => Uint8Array;

    constructor(encode: (id: string) => Uint8Array) {
        this.encode = encode;
    }
}

type Handler<T extends RequestType> = (
    payload: RequestMap[T]['payload'],
    client: ClientConnection
) => RequestMap[T]['result'] | BinaryReply | Promise<RequestMap[T]['result'] | BinaryReply>;

// Thrown by a handler to answer with a specific error code instead of a generic failure.
export class RequestError extends CodedError {}

/*
 * What a handler runs its work through: a failure that carries a code answers under it, and anything
 * else stays an internal error for the dispatcher to report.
 */
export function translate<T>(work: () => T | Promise<T>): Promise<T> {
    return Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof CodedError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });
}

function errorReply(id: string | null, code: string, message: string): ReplyError {
    return {
        id,
        ok: false,
        error: { code, message }
    };
}

export class Dispatcher {
    private readonly handlers = new Map<RequestType, Handler<RequestType>>();

    register<T extends RequestType>(type: T, handler: Handler<T>): void {
        if (this.handlers.has(type)) {
            throw new Error(`Handler for ${type} is already registered`);
        }
        this.handlers.set(type, handler as Handler<RequestType>);
    }

    has(type: RequestType): boolean {
        return this.handlers.has(type);
    }

    async handle(client: ClientConnection, raw: string | Uint8Array): Promise<void> {
        let json: unknown;
        try {
            json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
        } catch {
            client.send(errorReply(null, 'bad-request', 'Frame is not valid JSON'));
            return;
        }

        const parsed = parseRequest(json);
        if (!parsed.ok) {
            // Keep the id when the frame carried a usable one, so the caller can settle its promise.
            const id = typeof json === 'object' && json !== null && 'id' in json && typeof json.id === 'string' && json.id !== '' ? json.id : null;
            client.send(errorReply(id, 'bad-request', parsed.message));
            return;
        }

        const { id, type, payload } = parsed.value;
        const handler = isRequestType(type) ? this.handlers.get(type) : undefined;
        if (!isRequestType(type) || !handler) {
            client.send(errorReply(id, 'unknown-request', `Unknown request type: ${type}`));
            return;
        }

        const payloadParse = REQUEST_SCHEMAS[type].payload.safeParse(payload);
        if (!payloadParse.success) {
            client.send(errorReply(id, 'bad-request', `Invalid payload for ${type}`));
            return;
        }

        try {
            const result = await handler(payloadParse.data, client);
            if (result instanceof BinaryReply && client.sendBinary) {
                client.sendBinary(result.encode(id));
                return;
            }
            client.send({ id, ok: true, result });
        } catch (e) {
            if (e instanceof RequestError) {
                client.send(errorReply(id, e.code, e.message));
                return;
            }
            console.error(`Handler for ${type} failed:`, errorText(e));
            client.send(errorReply(id, 'internal', 'Request failed'));
        }
    }
}
