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

export interface ClientAccess {
    reachability: 'loopback' | 'lan' | 'tunnel' | 'public';
    // The paired session behind the socket; null for a loopback client, which needs none.
    sessionId: string | null;
}

export interface ClientConnection {
    // Unique per socket for the life of the daemon, so a handler can attach a session to exactly this client.
    readonly id: string;
    readonly access?: ClientAccess;
    send(frame: ServerFrame): void;
}

export const sendEvent = <E extends EventType>(client: ClientConnection, event: E, payload: EventMap[E]): void => {
    client.send({ type: 'event', event, payload });
};

export type Handler<T extends RequestType> = (
    payload: RequestMap[T]['payload'],
    client: ClientConnection
) => RequestMap[T]['result'] | Promise<RequestMap[T]['result']>;

// Thrown by a handler to answer with a specific error code instead of a generic failure.
export class RequestError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
    }
}

const errorReply = (id: string | null, code: string, message: string): ReplyError => ({
    id,
    ok: false,
    error: { code, message }
});

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
            client.send({ id, ok: true, result });
        } catch (e) {
            if (e instanceof RequestError) {
                client.send(errorReply(id, e.code, e.message));
                return;
            }
            console.error(`Handler for ${type} failed`, e);
            client.send(errorReply(id, 'internal', 'Request failed'));
        }
    }
}
