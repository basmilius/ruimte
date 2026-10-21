import { spyOn } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS, type EventMap, type EventType, type RequestMap, type RequestType } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, endpointById, type Endpoint } from '@/state/endpoints';
import { pool } from '@/transport';
import type { PooledTransport } from '@/transport/pool';
import { TransportError, type ConnectionState, type TransportStatus } from '@/transport/transport';

const OPEN: ConnectionState = { status: 'open', attempts: 0, retryAt: null, features: Object.keys(REQUEST_SCHEMAS) };

interface SchemaDef {
    type: string;
    shape?: Record<string, { _zod: { def: SchemaDef; optin?: string } }>;
    innerType?: { _zod: { def: SchemaDef } };
    options?: Array<{ _zod: { def: SchemaDef } }>;
    in?: { _zod: { def: SchemaDef } };
    values?: unknown[];
    entries?: Record<string, unknown>;
}

/*
 * The emptiest answer the wire allows: no rows in a list, nothing in a map, a field left out where it
 * may be. What a machine with nothing on it says, read off the schema the client parses it with.
 */
function emptyOf(def: SchemaDef): unknown {
    switch (def.type) {
        case 'object':
            return Object.fromEntries(
                Object.entries(def.shape ?? {})
                    .filter(([, field]) => field._zod.optin !== 'optional')
                    .map(([name, field]) => [name, emptyOf(field._zod.def)])
            );
        case 'array':
            return [];
        case 'record':
            return {};
        case 'string':
            return '';
        case 'number':
        case 'int':
            return 0;
        case 'boolean':
            return false;
        case 'null':
        case 'nullable':
            return null;
        case 'literal':
            return def.values?.[0];
        case 'enum':
            return Object.values(def.entries ?? {})[0];
        case 'union':
            return emptyOf(def.options![0]!._zod.def);
        case 'pipe':
            return emptyOf(def.in!._zod.def);
        case 'default':
        case 'readonly':
        case 'catch':
        case 'nonoptional':
            return emptyOf(def.innerType!._zod.def);
        default:
            return undefined;
    }
}

type Answer<T extends RequestType> = (payload: RequestMap[T]['payload']) => RequestMap[T]['result'] | Promise<RequestMap[T]['result']>;

export interface SentRequest {
    type: RequestType;
    payload: unknown;
}

/* A machine that answers what a test tells it to and the emptiest answer to everything else, and keeps every request it got. */
export class FakeMachine implements PooledTransport {
    connection: ConnectionState = OPEN;
    readonly sent: SentRequest[] = [];
    private readonly answers = new Map<RequestType, Answer<RequestType>>();
    private readonly handlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    get status(): TransportStatus {
        return this.connection.status;
    }

    /* The socket going down and coming back, the way a reconnect looks to every client on it. */
    drop(): void {
        this.setStatus('closed');
    }

    reopen(): void {
        this.connection = { ...this.connection, attempts: 0 };
        this.setStatus('open');
    }

    /* The link gone and a try to bring it back failed, which is what makes a machine lost and not just still loading. */
    lose(failure?: string): void {
        this.connection = { ...this.connection, attempts: 1, ...(failure === undefined ? {} : { failure }) };
        this.setStatus('closed');
    }

    /* How often the pool was asked to bring the link up again. */
    reconnects = 0;

    /* A machine that names only these requests, the way an older release does; every other request stays answerable but `machineAnswers` says no. */
    answersOnly(types: readonly RequestType[]): void {
        this.connection = { ...this.connection, features: [...types] };
        this.setStatus(this.status);
    }

    answer<T extends RequestType>(type: T, answer: Answer<T>): void {
        this.answers.set(type, answer as unknown as Answer<RequestType>);
    }

    /* The requests of one type, in the order they came. */
    requests<T extends RequestType>(type: T): Array<RequestMap[T]['payload']> {
        return this.sent.filter((request) => request.type === type).map((request) => request.payload as RequestMap[T]['payload']);
    }

    /* Checked against the event's schema, as a client checks what a machine sends, so a test cannot hand a view a shape no machine sends. */
    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        EVENT_SCHEMAS[event].parse(payload);
        for (const handler of this.handlers.get(event) ?? []) {
            (handler as (payload: EventMap[E]) => void)(payload);
        }
    }

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (this.status !== 'open') {
            throw new TransportError('not-connected', 'The fake machine is down');
        }
        this.sent.push({ type, payload });
        // The same list after a fresh look, so a test that tells the machine its providers tells it once.
        const answer = this.answers.get(type) ?? (type === 'provider.detect' ? this.answers.get('provider.list') : undefined);
        if (answer !== undefined) {
            return (await answer(payload)) as RequestMap[T]['result'];
        }
        const schema = (REQUEST_SCHEMAS as unknown as Record<string, { result: { _zod: { def: SchemaDef } } }>)[type];
        return emptyOf(schema!.result._zod.def) as RequestMap[T]['result'];
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.handlers.get(event);
        if (handlers === undefined) {
            handlers = new Set();
            this.handlers.set(event, handlers);
        }
        handlers.add(handler as (payload: never) => void);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    private setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };
        for (const handler of [...this.statusHandlers]) {
            handler(status);
        }
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {
        this.reconnects += 1;
    }

    dispose(): void {}
}

/*
 * The fakes behind the rows of the pool, by endpoint. One spy on the door a socket opens through hands
 * every row its own fake, so a test with two machines reaches each the way a client reaches a daemon.
 */
const fakes = new Map<string, FakeMachine>();
let door: { mockRestore(): void } | null = null;

/*
 * Puts a fake behind a machine's row in the pool, the one door a socket opens through, so every
 * client of the page reaches it the way it reaches a daemon. The returned function lets it go again.
 */
export function connectFakeMachine(machine: FakeMachine, endpointId: string = LOCAL_ENDPOINT_ID): () => void {
    const endpoint = endpointById(endpointId);
    if (endpoint === null) {
        throw new Error(`No row for ${endpointId}`);
    }
    fakes.set(endpointId, machine);
    door ??= spyOn(pool as unknown as { open: (row: Endpoint) => PooledTransport }, 'open').mockImplementation((row) => fakes.get(row.id) ?? machine);
    const release = pool.hold(endpoint);
    return () => {
        release();
        pool.drop(endpointId);
        fakes.delete(endpointId);
        if (fakes.size === 0) {
            door?.mockRestore();
            door = null;
        }
    };
}
