import { CodedError } from '@adecore/agents';
import { REQUEST_SCHEMAS, isRequestType, parseRequest, type ReplyError, type RequestMap, type RequestType } from '@ruimte/contracts';
import type { UsageReportCounter } from '@ruimte/pulsar';
import { isOwner } from './auth/access.ts';
import { errorText } from './error-text.ts';
import type { ClientConnection } from './wire.ts';

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

/* What an answered request adds to the usage counts; `once` counts a key once per day, like a file a person opened. */
export type UsageCount = UsageReportCounter | { counter: UsageReportCounter; once: string };

/* Told of every request the dispatcher answers, so what counts or times them stays out of its imports. */
export interface RequestObserver {
    started?(type: RequestType): void;
    answered?(type: RequestType, ms: number, counts: readonly UsageCount[]): void;
}

interface HandlerOptions<T extends RequestType> {
    /* Only a client that presented the local secret may ask; any other is refused as `forbidden` before the handler runs. */
    owner?: boolean;
    /*
     * Puts the request on the list a peer (another machine) may ask. Every other request is refused to a
     * peer as `forbidden`, so a request registered later stays closed to it until someone adds it here.
     * An owner-only request can never carry it.
     */
    peer?: boolean;
    /* What a person's request counts once it was answered, by what its payload says when that matters. */
    count?: readonly UsageCount[] | ((payload: RequestMap[T]['payload']) => readonly UsageCount[]);
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
    private readonly ownerOnly = new Set<RequestType>();
    private readonly peerAllowed = new Set<RequestType>();
    private readonly counts = new Map<RequestType, (payload: never) => readonly UsageCount[]>();
    private readonly observers: RequestObserver[] = [];

    register<T extends RequestType>(type: T, handler: Handler<T>, options: HandlerOptions<T> = {}): void {
        if (this.handlers.has(type)) {
            throw new Error(`Handler for ${type} is already registered`);
        }
        if (options.owner === true && options.peer === true) {
            throw new Error(`${type} cannot be owner-only and open to a peer`);
        }
        this.handlers.set(type, handler as Handler<RequestType>);
        if (options.owner === true) {
            this.ownerOnly.add(type);
        }
        if (options.peer === true) {
            this.peerAllowed.add(type);
        }
        const { count } = options;
        if (count !== undefined) {
            this.counts.set(type, typeof count === 'function' ? count : () => count);
        }
    }

    observe(observer: RequestObserver): void {
        this.observers.push(observer);
    }

    has(type: RequestType): boolean {
        return this.handlers.has(type);
    }

    types(): RequestType[] {
        return [...this.handlers.keys()];
    }

    /* The requests a peer may ask, which is all `endpoint.info` tells it about. */
    peerTypes(): RequestType[] {
        return [...this.peerAllowed];
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
        if (client.access?.peer !== undefined && !(isRequestType(type) && this.peerAllowed.has(type))) {
            client.send(errorReply(id, 'forbidden', 'Another machine may not ask this'));
            return;
        }
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

        if (this.ownerOnly.has(type) && !isOwner(client.access)) {
            client.send(errorReply(id, 'forbidden', 'Only a person on this machine may ask this'));
            return;
        }

        const started = performance.now();
        for (const observer of this.observers) {
            observer.started?.(type);
        }

        try {
            const result = await handler(payloadParse.data, client);
            const elapsed = performance.now() - started;
            const counted = this.counts.get(type)?.(payloadParse.data as never) ?? [];
            for (const observer of this.observers) {
                observer.answered?.(type, elapsed, counted);
            }
            if (result instanceof BinaryReply && client.sendBinary) {
                client.sendBinary(result.encode(id));
                return;
            }
            client.send({ id, ok: true, result });
        } catch (e) {
            if (e instanceof CodedError) {
                client.send(errorReply(id, e.code, e.message));
                return;
            }
            console.error(`Handler for ${type} failed:`, errorText(e));
            client.send(errorReply(id, 'internal', 'Request failed'));
        }
    }
}
