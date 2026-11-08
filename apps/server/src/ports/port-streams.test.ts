import { beforeEach, describe, expect, test } from 'bun:test';
import { PORT_BUFFER_BYTES, PORT_CHUNK_BYTES, PORT_CLIENT_STREAMS, PORT_MACHINE_STREAMS, PORT_WINDOW_BYTES } from '@ruimte/contracts';
import { PortStreams } from './port-streams.ts';
import { eventsOf, fakeClient, FakeNetwork, FakeTimers, testGrants } from './port-test-helpers.ts';

let network: FakeNetwork;
let timers: FakeTimers;
let streams: PortStreams;
let grants: ReturnType<typeof testGrants>['grants'];

beforeEach(() => {
    network = new FakeNetwork();
    timers = new FakeTimers();
    grants = testGrants().grants;
    streams = new PortStreams({ grants, connect: network.connect, timers });
});

function bytes(length: number, fill = 1): Uint8Array {
    return new Uint8Array(length).fill(fill);
}

async function opened(clientId = 'client-1', streamId = 'stream-01', options: { bounded?: boolean } = {}) {
    const client = fakeClient(clientId, options);
    const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');
    await streams.open(client, streamId, grant.id);

    return { client, grant, service: network.services.at(-1)! };
}

describe('opening a stream', () => {
    test('connects to the literal address of the grant and nothing else', async () => {
        const client = fakeClient('client-1');
        const v6 = grants.share('project-1', 8080, '::1', 'person');

        await streams.open(client, 'stream-01', v6.id);

        expect(network.asked).toEqual([{ host: '::1', port: 8080 }]);
    });

    test('refuses a grant that is not shared, without connecting', async () => {
        await expect(streams.open(fakeClient('client-1'), 'stream-01', 'nope')).rejects.toMatchObject({ code: 'unknown-grant' });
        expect(network.asked).toEqual([]);
    });

    test("refuses a port that became one of Ruimte's own after it was shared", async () => {
        const denied = [4210];
        const local = testGrants(denied);
        const own = new PortStreams({ grants: local.grants, connect: network.connect, timers });
        const grant = local.grants.share('project-1', 4300, '127.0.0.1', 'person');

        denied.push(4300);

        await expect(own.open(fakeClient('client-1'), 'stream-01', grant.id)).rejects.toMatchObject({ code: 'port-denied' });
        expect(network.asked).toEqual([]);
    });

    test('says when nothing answers and does not try the other address family', async () => {
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');
        network.refuse = true;

        await expect(streams.open(fakeClient('client-1'), 'stream-01', grant.id)).rejects.toMatchObject({ code: 'port-unreachable' });
        expect(network.asked).toEqual([{ host: '127.0.0.1', port: 3000 }]);
        expect(streams.count()).toBe(0);
    });

    test('refuses an id that is open already and the seventeenth stream of a client', async () => {
        const { client, grant } = await opened();

        await expect(streams.open(client, 'stream-01', grant.id)).rejects.toMatchObject({ code: 'stream-exists' });

        for (let i = 1; i < PORT_CLIENT_STREAMS; i += 1) {
            await streams.open(client, `stream-${String(i + 1).padStart(2, '0')}`, grant.id);
        }

        await expect(streams.open(client, 'stream-99', grant.id)).rejects.toMatchObject({ code: 'port-busy' });
    });

    test('refuses a stream past the limit of the machine', async () => {
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');

        for (let i = 0; i < PORT_MACHINE_STREAMS / PORT_CLIENT_STREAMS; i += 1) {
            const client = fakeClient(`client-${i}`);

            for (let n = 0; n < PORT_CLIENT_STREAMS; n += 1) {
                await streams.open(client, `stream-${i}-${String(n).padStart(2, '0')}`, grant.id);
            }
        }

        await expect(streams.open(fakeClient('client-late'), 'stream-late', grant.id)).rejects.toMatchObject({ code: 'port-busy' });
    });
});

describe('a stream belongs to its client', () => {
    test('answers a foreign handle as an unknown stream, for every operation', async () => {
        await opened('client-1', 'stream-01');
        const stranger = fakeClient('client-2');

        await expect(streams.write(stranger, 'stream-01', 0, bytes(1))).rejects.toMatchObject({ code: 'unknown-stream' });
        expect(() => streams.credit(stranger, 'stream-01', 10)).toThrow(/not open/);
        expect(() => streams.close(stranger, 'stream-01', undefined)).toThrow(/not open/);
        expect(streams.count()).toBe(1);
    });

    test('lets two clients use the same stream id', async () => {
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');

        await streams.open(fakeClient('client-1'), 'stream-01', grant.id);
        await streams.open(fakeClient('client-2'), 'stream-01', grant.id);

        expect(streams.count()).toBe(2);
    });

    test('ends everything a client opened when its channel goes, and tells nobody', async () => {
        const { client, service } = await opened();

        streams.channelClosed(client.id);

        expect(service.closed).toBe(true);
        expect(streams.count()).toBe(0);
        expect(client.frames).toEqual([]);
    });
});

describe('writing toward the service', () => {
    test('answers with the bytes the service took once they are written', async () => {
        const { client, service } = await opened();

        expect(await streams.write(client, 'stream-01', 0, bytes(10))).toEqual({ flushed: 10 });
        expect(await streams.write(client, 'stream-01', 10, bytes(5))).toEqual({ flushed: 15 });
        expect(service.written.map((chunk) => chunk.byteLength)).toEqual([10, 5]);
    });

    test('ends the stream on a gap or a replay and never writes the bytes', async () => {
        const { client, service } = await opened();

        await streams.write(client, 'stream-01', 0, bytes(10));
        await expect(streams.write(client, 'stream-01', 0, bytes(10))).rejects.toMatchObject({ code: 'bad-offset' });

        expect(service.written).toHaveLength(1);
        expect(service.closed).toBe(true);
        expect(eventsOf(client, 'port.end')).toEqual([{ streamId: 'stream-01', offset: 0, reason: 'error', message: expect.any(String) }]);
    });

    test('ends the stream when more is unanswered than the window allows', async () => {
        const { client, service } = await opened();
        service.stalled = true;

        const writes: Array<Promise<unknown>> = [];

        for (let i = 0; i < PORT_WINDOW_BYTES / PORT_CHUNK_BYTES; i += 1) {
            const write = streams.write(client, 'stream-01', i * PORT_CHUNK_BYTES, bytes(PORT_CHUNK_BYTES));
            write.catch(() => undefined);
            writes.push(write);
        }

        await expect(streams.write(client, 'stream-01', PORT_WINDOW_BYTES, bytes(1))).rejects.toMatchObject({ code: 'port-window' });
        expect(service.closed).toBe(true);
        expect(eventsOf(client, 'port.end')[0]).toMatchObject({ reason: 'overload' });
        await Promise.allSettled(writes);
    });

    test('refuses a chunk larger than one chunk', async () => {
        const { client } = await opened();

        await expect(streams.write(client, 'stream-01', 0, bytes(PORT_CHUNK_BYTES + 1))).rejects.toMatchObject({ code: 'port-window' });
    });

    test('ends the stream after five seconds without a write, and does not replay it', async () => {
        const { client, service } = await opened();
        service.stalled = true;

        const write = streams.write(client, 'stream-01', 0, bytes(10));
        const settled = write.catch((e: unknown) => e);

        timers.fire(5000);

        expect(await settled).toMatchObject({ code: 'port-stalled' });
        expect(service.closed).toBe(true);
        expect(service.written).toHaveLength(1);
    });

    test('settles a write waiting on the service with a failure when the grant is revoked', async () => {
        const { client, grant, service } = await opened();
        service.stalled = true;

        const settled = streams.write(client, 'stream-01', 0, bytes(10)).catch((e: unknown) => e);

        grants.revoke(grant.id);

        expect(await settled).toMatchObject({ code: 'stream-gone' });
    });

    test('shuts the write side after the writes before it, and keeps the answer coming', async () => {
        const { client, service } = await opened();
        service.stalled = true;

        const write = streams.write(client, 'stream-01', 0, bytes(3));
        streams.close(client, 'stream-01', 'write');
        await Promise.resolve();

        expect(service.shut).toBe(false);

        service.release();
        await write;
        await Promise.resolve();
        await Promise.resolve();

        expect(service.shut).toBe(true);
        await expect(streams.write(client, 'stream-01', 3, bytes(1))).rejects.toMatchObject({ code: 'stream-closed' });

        service.handlers.data(bytes(4));

        expect(eventsOf(client, 'port.data')).toHaveLength(1);
    });
});

describe('data toward the client', () => {
    test('sends chunks with the offset of their first byte, then the end of the stream once they are all out', async () => {
        const { client, service } = await opened();

        service.handlers.data(bytes(PORT_CHUNK_BYTES + 10, 7));
        service.handlers.ended(null);

        const data = eventsOf(client, 'port.data');

        expect(data.map((event) => event.offset)).toEqual([0, PORT_CHUNK_BYTES]);
        expect(Buffer.from(data[1]!.data as string, 'base64').byteLength).toBe(10);
        expect(eventsOf(client, 'port.end')).toEqual([{ streamId: 'stream-01', offset: PORT_CHUNK_BYTES + 10, reason: 'eof' }]);
        expect(streams.count()).toBe(0);
    });

    test('stops at the credit the client granted and goes on when it consumed some', async () => {
        const { client, service } = await opened();

        service.handlers.data(bytes(PORT_WINDOW_BYTES + 5 * PORT_CHUNK_BYTES));

        const sentBytes = (): number => eventsOf(client, 'port.data').reduce((sum, event) => sum + Buffer.from(event.data as string, 'base64').byteLength, 0);

        expect(sentBytes()).toBe(PORT_WINDOW_BYTES);

        streams.credit(client, 'stream-01', PORT_CHUNK_BYTES);

        expect(sentBytes()).toBe(PORT_WINDOW_BYTES + PORT_CHUNK_BYTES);
    });

    test('adds no window for credit that repeats, goes back or claims more than was sent', async () => {
        const { client, service } = await opened();

        service.handlers.data(bytes(PORT_WINDOW_BYTES * 2));
        streams.credit(client, 'stream-01', PORT_CHUNK_BYTES);
        streams.credit(client, 'stream-01', PORT_CHUNK_BYTES);
        streams.credit(client, 'stream-01', 100);

        const sent = eventsOf(client, 'port.data').reduce((sum, event) => sum + Buffer.from(event.data as string, 'base64').byteLength, 0);

        expect(sent).toBe(PORT_WINDOW_BYTES + PORT_CHUNK_BYTES);

        streams.credit(client, 'stream-01', 10 * PORT_WINDOW_BYTES);

        const after = eventsOf(client, 'port.data').reduce((sum, event) => sum + Buffer.from(event.data as string, 'base64').byteLength, 0);

        expect(after).toBe(PORT_WINDOW_BYTES * 2);
    });

    test('pauses the service while output waits and lets it go again when it drained', async () => {
        const { client, service } = await opened();

        service.handlers.data(bytes(PORT_WINDOW_BYTES + 80 * 1024));

        expect(service.pauses).toBe(1);

        streams.credit(client, 'stream-01', PORT_WINDOW_BYTES);

        expect(service.resumes).toBe(1);
    });

    test('cuts off a service that ignores the pause and floods the queue', async () => {
        const { client, service } = await opened();

        service.handlers.data(bytes(PORT_WINDOW_BYTES));
        service.handlers.data(bytes(1200 * 1024));

        expect(service.closed).toBe(true);
        expect(eventsOf(client, 'port.end')[0]).toMatchObject({ reason: 'overload' });
    });

    test('holds a chunk back while the channel holds too much, and sends it after the drain', async () => {
        const { client, service } = await opened('client-1', 'stream-01', { bounded: true });

        client.buffered = PORT_BUFFER_BYTES - 100;
        service.handlers.data(bytes(1000));

        expect(eventsOf(client, 'port.data')).toHaveLength(0);
        expect(client.drains).toHaveLength(1);

        client.drain();

        expect(eventsOf(client, 'port.data')).toHaveLength(1);
    });

    test('asks a full channel again when no drain came', async () => {
        const { client, service } = await opened('client-1', 'stream-01', { bounded: true });

        client.buffered = PORT_BUFFER_BYTES;
        service.handlers.data(bytes(1000));
        client.buffered = 0;

        expect(timers.pending).toEqual([20]);

        timers.fire(20);

        expect(eventsOf(client, 'port.data')).toHaveLength(1);
    });

    test('sends the end of a stream behind the data that waits for room', async () => {
        const { client, service } = await opened('client-1', 'stream-01', { bounded: true });

        client.buffered = PORT_BUFFER_BYTES;
        service.handlers.data(bytes(1000));
        service.handlers.ended('reset by peer');

        expect(eventsOf(client, 'port.end')).toEqual([]);

        client.drain();

        expect(eventsOf(client, 'port.data')).toHaveLength(1);
        expect(eventsOf(client, 'port.end')).toEqual([{ streamId: 'stream-01', offset: 1000, reason: 'error', message: 'reset by peer' }]);
    });
});

describe('revoking a grant', () => {
    test('ends every stream of it with a word to its client and leaves the streams of other grants', async () => {
        const { client, grant, service } = await opened();
        const other = grants.share('project-1', 4000, '127.0.0.1', 'person');
        const second = fakeClient('client-2');

        await streams.open(second, 'stream-02', other.id);
        service.handlers.data(bytes(10));
        grants.revoke(grant.id);

        expect(service.closed).toBe(true);
        expect(eventsOf(client, 'port.end')).toEqual([{ streamId: 'stream-01', offset: 10, reason: 'revoked', message: expect.any(String) }]);
        expect(eventsOf(second, 'port.end')).toEqual([]);
        expect(streams.count()).toBe(1);
    });

    test('ends a stream that was still connecting', async () => {
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');
        let release: () => void = () => undefined;
        const slow = new PortStreams({
            grants,
            timers,
            connect: async (host, port, handlers) => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });

                return network.connect(host, port, handlers);
            }
        });
        const opening = slow.open(fakeClient('client-1'), 'stream-01', grant.id).catch((e: unknown) => e);

        grants.revoke(grant.id);
        release();

        expect(await opening).toMatchObject({ code: 'stream-gone' });
        expect(network.services[0]?.closed).toBe(true);
        expect(slow.count()).toBe(0);
    });
});
