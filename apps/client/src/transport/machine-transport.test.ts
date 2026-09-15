import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Endpoint } from '../state/endpoints';
import { MachineTransports } from './machine-transport';
import { TransportPool, type PooledTransport } from './pool';
import type { ConnectionState, TransportStatus } from './transport';

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: null,
    daemonPublicKey: null
});

class FakeLink implements PooledTransport {
    connection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null };
    private readonly handlers = new Set<(status: TransportStatus) => void>();

    get status(): TransportStatus {
        return this.connection.status;
    }

    setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };
        for (const handler of [...this.handlers]) {
            handler(status);
        }
    }

    request<T extends RequestType>(): Promise<RequestMap[T]['result']> {
        return Promise.resolve(undefined as RequestMap[T]['result']);
    }

    on<E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void): () => void {
        return () => undefined;
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {}

    dispose(): void {}
}

const setup = () => {
    const opened: FakeLink[] = [];
    const pool = new TransportPool({
        idleMs: 1,
        open: () => {
            const link = new FakeLink();
            opened.push(link);
            return link;
        }
    });
    return { pool, opened, transports: new MachineTransports(pool) };
};

describe('the transport of one machine', () => {
    test('is the same object for a machine, and making it opens no link', async () => {
        const { pool, opened, transports } = setup();
        const transport = transports.of('a');
        expect(transports.of('a')).toBe(transport);
        expect(transport.status).toBe('closed');
        expect(opened).toHaveLength(0);
        expect(pool.ids()).toEqual([]);
        await expect(transport.request('server.ping', {})).rejects.toThrow('not connected');
    });

    test('follows the link as a hold opens it, and stays when it closes', () => {
        const { pool, opened, transports } = setup();
        const transport = transports.of('a');
        const heard: TransportStatus[] = [];
        transport.subscribeStatus((status) => heard.push(status));

        const release = pool.hold(endpoint('a'));
        opened[0]!.setStatus('open');
        expect(transport.status).toBe('open');

        release();
        pool.drop('a');
        expect(transport.status).toBe('closed');
        expect(heard).toEqual(['connecting', 'open', 'closed']);
    });

    test('a row that learns its daemon id keeps its link without a word about closing', () => {
        const { pool, opened, transports } = setup();
        const transport = transports.of('10.0.0.4:4210');
        pool.hold(endpoint('10.0.0.4:4210'));
        opened[0]!.setStatus('open');
        const heard: TransportStatus[] = [];
        transport.subscribeStatus((status) => heard.push(status));

        transports.rekey('10.0.0.4:4210', 'daemon-a');
        pool.rekey('10.0.0.4:4210', 'daemon-a', 'ws://10.0.0.4:4210/ws');

        expect(transports.of('daemon-a')).toBe(transport);
        expect(transport.status).toBe('open');
        expect(heard).toEqual([]);
    });
});
