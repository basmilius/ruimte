import { beforeEach, describe, expect, test } from 'bun:test';
import { PORT_CHUNK_BYTES, PORT_WINDOW_BYTES } from '@ruimte/contracts';
import { FakePortTransport } from './port-test-transport';
import { PortStreamHub, type PortStreamClient, type PortStreamHandlers } from './stream-client';

let transport: FakePortTransport;
let hub: PortStreamHub;
let received: Uint8Array[];
let flushed: number[];
let ends: Array<string | null>;

beforeEach(() => {
    transport = new FakePortTransport();
    hub = new PortStreamHub(transport);
    received = [];
    flushed = [];
    ends = [];
});

const handlers = (): PortStreamHandlers => ({
    data: (bytes) => received.push(bytes),
    flushed: (total) => flushed.push(total),
    end: (reason) => ends.push(reason)
});

async function opened(window = PORT_WINDOW_BYTES): Promise<PortStreamClient> {
    transport.reply('port.open', () => ({ window }));

    return hub.open('grant-1', handlers());
}

function base64(text: string): string {
    return Buffer.from(text).toString('base64');
}

describe('PortStreamClient', () => {
    test('opens a stream with an id of its own on the grant', async () => {
        const stream = await opened();

        expect(transport.of('port.open')).toEqual([{ streamId: stream.id, grantId: 'grant-1' }]);
        expect(stream.id).toMatch(/^s-/);
        expect(hub.count).toBe(1);
    });

    test('forgets a stream the machine refused to open', async () => {
        transport.reply('port.open', () => Promise.reject(new Error('Nothing answers')));

        await expect(hub.open('grant-1', handlers())).rejects.toThrow('Nothing answers');
        expect(hub.count).toBe(0);
    });

    test('cuts writes into chunks with the offset of each and stops at the window until the machine answers', async () => {
        const stream = await opened(2 * PORT_CHUNK_BYTES);

        stream.write(new Uint8Array(PORT_CHUNK_BYTES * 3 + 5));

        const writes = (): Array<Record<string, unknown>> => transport.of('port.write');

        expect(writes().map((write) => write.offset)).toEqual([0, PORT_CHUNK_BYTES]);

        transport.asked.find((request) => request.type === 'port.write')!.resolve({ flushed: PORT_CHUNK_BYTES });
        await Promise.resolve();
        await Promise.resolve();

        expect(flushed).toEqual([PORT_CHUNK_BYTES]);
        expect(writes().map((write) => write.offset)).toEqual([0, PORT_CHUNK_BYTES, 2 * PORT_CHUNK_BYTES]);
    });

    test('ends the stream and tells the machine when a write is refused', async () => {
        const stream = await opened();

        stream.write(new Uint8Array(10));
        transport.asked.find((request) => request.type === 'port.write')!.reject(new Error('The service did not take the bytes in time'));
        await Promise.resolve();
        await Promise.resolve();

        expect(ends).toEqual(['The service did not take the bytes in time']);
        expect(transport.of('port.close')).toEqual([{ streamId: stream.id }]);
        expect(hub.count).toBe(0);
    });

    test('hands on data in order and refuses a gap', async () => {
        const stream = await opened();

        transport.emit('port.data', { streamId: stream.id, offset: 0, data: base64('hel') });
        transport.emit('port.data', { streamId: stream.id, offset: 3, data: base64('lo') });

        expect(received.map((bytes) => Buffer.from(bytes).toString())).toEqual(['hel', 'lo']);

        transport.emit('port.data', { streamId: stream.id, offset: 99, data: base64('x') });

        expect(ends).toEqual(['Bytes of the page were lost on the way']);
        expect(received).toHaveLength(2);
    });

    test('ignores data for a stream it does not hold', async () => {
        await opened();
        transport.emit('port.data', { streamId: 's-other-stream', offset: 0, data: base64('x') });

        expect(received).toEqual([]);
    });

    test('passes the end of the stream on only when every byte arrived', async () => {
        const stream = await opened();

        transport.emit('port.data', { streamId: stream.id, offset: 0, data: base64('abc') });
        transport.emit('port.end', { streamId: stream.id, offset: 3, reason: 'eof' });

        expect(ends).toEqual([null]);

        const second = await opened();

        transport.emit('port.end', { streamId: second.id, offset: 10, reason: 'eof' });

        expect(ends).toEqual([null, 'Bytes of the page were lost on the way']);
    });

    test('tells why a stream ended when the machine did not finish it', async () => {
        const stream = await opened();

        transport.emit('port.end', { streamId: stream.id, offset: 0, reason: 'revoked', message: 'Sharing this port was stopped' });

        expect(ends).toEqual(['Sharing this port was stopped']);
    });

    test('gives the machine credit in steps of what the page used, as an absolute number', async () => {
        const stream = await opened();

        stream.consumed(4 * 1024);
        stream.consumed(4 * 1024);

        expect(transport.of('port.credit')).toEqual([]);

        stream.consumed(8 * 1024);
        stream.consumed(20 * 1024);

        expect(transport.of('port.credit')).toEqual([
            { streamId: stream.id, offset: 16 * 1024 },
            { streamId: stream.id, offset: 36 * 1024 }
        ]);
    });

    test('shuts the write side only after the writes before it were answered', async () => {
        const stream = await opened();

        stream.write(new Uint8Array(10));
        stream.closeWrite();

        expect(transport.of('port.close')).toEqual([]);

        transport.asked.find((request) => request.type === 'port.write')!.resolve({ flushed: 10 });
        await Promise.resolve();
        await Promise.resolve();

        expect(transport.of('port.close')).toEqual([{ streamId: stream.id, half: 'write' }]);

        stream.write(new Uint8Array(3));

        expect(transport.of('port.write')).toHaveLength(1);
    });

    test('closing tells the machine once, and abortAll ends every stream without telling it', async () => {
        const first = await opened();
        await opened();

        first.close();
        first.close();

        expect(transport.of('port.close')).toEqual([{ streamId: first.id }]);

        hub.abortAll('The connection to the machine was lost');

        expect(ends).toEqual(['The connection to the machine was lost']);
        expect(transport.of('port.close')).toHaveLength(1);
        expect(hub.count).toBe(0);
    });

    test('stops listening when the hub is disposed', async () => {
        await opened();

        expect(transport.listening).toBe(2);

        hub.dispose('done');

        expect(transport.listening).toBe(0);
    });
});
