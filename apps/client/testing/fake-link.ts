import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState, TransportStatus } from '@/transport-api/transport';
import type { PooledTransport } from '@/transport/pool';

export function endpoint(id: string): Endpoint {
    return {
        id,
        label: id,
        httpBaseUrl: `http://${id}`,
        wsBaseUrl: `ws://${id}`,
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    };
}

/* A transport that answers nothing and tells its status handlers when a test moves its status. */
export class FakeLink implements PooledTransport {
    connection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null };
    readonly #handlers = new Set<(status: TransportStatus) => void>();

    get status(): TransportStatus {
        return this.connection.status;
    }

    setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };

        for (const handler of [...this.#handlers]) {
            handler(status);
        }
    }

    request<T extends RequestType>(_type?: T, _payload?: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        return Promise.resolve(undefined as RequestMap[T]['result']);
    }

    on<E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void): () => void {
        return () => undefined;
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.#handlers.add(handler);

        return () => {
            this.#handlers.delete(handler);
        };
    }

    switchTo(_address?: unknown): void {}

    retarget(_address?: unknown): void {}

    reconnect(): void {}

    dispose(): void {}
}
