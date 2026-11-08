import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server, type Socket } from 'node:net';
import { PORT_CHUNK_BYTES, PORT_WINDOW_BYTES } from '@ruimte/contracts';
import { connectLoopback } from './port-connect.ts';
import { PortStreams } from './port-streams.ts';
import { fakeClient, FakeTimers, testGrants } from './port-test-helpers.ts';

/* Real sockets on loopback: a service on each address family and a stream through the real connector. */
const servers: Server[] = [];

afterEach(() => {
    servers.splice(0).forEach((server) => server.close());
});

async function listen(host: '127.0.0.1' | '::1', onSocket: (socket: Socket) => void): Promise<number> {
    const server = createServer(onSocket);

    servers.push(server);

    await new Promise<void>((resolve) => server.listen({ host, port: 0 }, () => resolve()));

    return (server.address() as { port: number }).port;
}

function streamsFor(): { streams: PortStreams; grants: ReturnType<typeof testGrants>['grants'] } {
    const { grants } = testGrants([]);

    return { grants, streams: new PortStreams({ grants, connect: connectLoopback, timers: new FakeTimers() }) };
}

async function until(done: () => boolean): Promise<void> {
    for (let i = 0; i < 2000 && !done(); i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

describe('a stream through the real connector', () => {
    test('writes to a service on 127.0.0.1 and hears its answer, then its end', async () => {
        const port = await listen('127.0.0.1', (socket) => {
            socket.once('data', (data) => socket.end(`echo:${data.toString()}`));
        });
        const { streams, grants } = streamsFor();
        const client = fakeClient('client-1');
        const grant = grants.share('project-1', port, '127.0.0.1', 'person');

        await streams.open(client, 'stream-01', grant.id);

        expect(await streams.write(client, 'stream-01', 0, Buffer.from('hello'))).toEqual({ flushed: 5 });

        await until(() => client.frames.some((frame) => 'event' in frame && frame.event === 'port.end'));

        const text = client.frames
            .flatMap((frame) =>
                'event' in frame && frame.event === 'port.data' ? [Buffer.from((frame.payload as { data: string }).data, 'base64').toString()] : []
            )
            .join('');

        expect(text).toBe('echo:hello');
        expect(client.frames.at(-1)).toMatchObject({ event: 'port.end', payload: { reason: 'eof', offset: 10 } });
    });

    test('reaches a service that listens on ::1 only, and only when the grant names ::1', async () => {
        const port = await listen('::1', (socket) => socket.end('v6'));
        const { streams, grants } = streamsFor();
        const client = fakeClient('client-1');
        const wrong = grants.share('project-1', port, '127.0.0.1', 'person');
        const right = grants.share('project-1', port, '::1', 'person');

        await expect(streams.open(client, 'stream-01', wrong.id)).rejects.toMatchObject({ code: 'port-unreachable' });
        await streams.open(client, 'stream-02', right.id);
        await until(() => client.frames.some((frame) => 'event' in frame && frame.event === 'port.end'));

        expect(client.frames.some((frame) => 'event' in frame && frame.event === 'port.data')).toBe(true);
    });

    test('says nothing answers on a port nobody listens on', async () => {
        const port = await listen('127.0.0.1', () => undefined);

        servers.splice(0).forEach((server) => server.close());
        await new Promise((resolve) => setTimeout(resolve, 20));

        const { streams, grants } = streamsFor();
        const grant = grants.share('project-1', port, '127.0.0.1', 'person');

        await expect(streams.open(fakeClient('client-1'), 'stream-01', grant.id)).rejects.toMatchObject({ code: 'port-unreachable' });
    });

    test('keeps a service that floods a slow client within the window, and loses no byte', async () => {
        const total = 8 * 1024 * 1024;
        const port = await listen('127.0.0.1', (socket) => {
            const chunk = Buffer.alloc(64 * 1024, 7);
            let sent = 0;
            const push = (): void => {
                while (sent < total) {
                    sent += chunk.length;

                    if (!socket.write(chunk)) {
                        socket.once('drain', push);

                        return;
                    }
                }

                socket.end();
            };

            push();
        });
        const { streams, grants } = streamsFor();
        const client = fakeClient('client-1');
        const grant = grants.share('project-1', port, '127.0.0.1', 'person');

        await streams.open(client, 'stream-01', grant.id);

        let received = 0;
        let peak = 0;

        // The client reads in turns, as a page does: what it has not credited yet is what the machine may hold in flight.
        for (let round = 0; round < 4000; round += 1) {
            await new Promise((resolve) => setImmediate(resolve));

            const data = client.frames
                .splice(0)
                .flatMap((frame) => ('event' in frame && frame.event === 'port.data' ? [frame.payload as { data: string }] : []));

            const roundBytes = data.reduce((sum, piece) => sum + Buffer.from(piece.data, 'base64').byteLength, 0);

            received += roundBytes;
            peak = Math.max(peak, roundBytes);

            if (received >= total) {
                break;
            }

            streams.credit(client, 'stream-01', received);
        }

        expect(received).toBe(total);
        expect(peak).toBeLessThanOrEqual(PORT_WINDOW_BYTES + PORT_CHUNK_BYTES);
    });
});
