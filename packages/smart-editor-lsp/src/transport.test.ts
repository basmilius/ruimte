import { describe, expect, it } from 'bun:test';
import { ContentLengthDecoder, connectWebSocket, createMemoryTransportPair, createStreamTransport, encodeMessage, type ByteStream } from './transport.ts';
import type { RpcMessage } from './protocol.ts';

const hello: RpcMessage = { jsonrpc: '2.0', method: 'hello', params: { text: '🙂 é' } };

describe('Content-Length framing', () => {
    it('reads messages that arrive in pieces and several at once', () => {
        const decoder = new ContentLengthDecoder();
        const bytes = new Uint8Array([...encodeMessage(hello), ...encodeMessage({ ...hello, method: 'second' })]);
        const messages: unknown[] = [];
        for (let i = 0; i < bytes.length; i += 7) {
            messages.push(...decoder.accept(bytes.subarray(i, i + 7)));
        }
        expect(messages).toEqual([hello, { ...hello, method: 'second' }]);
        expect(decoder.accept(bytes)).toHaveLength(2);
    });

    it('counts the length in bytes, not characters', () => {
        const framed = new TextDecoder().decode(encodeMessage(hello));
        expect(framed.startsWith(`Content-Length: ${new TextEncoder().encode(JSON.stringify(hello)).length}\r\n\r\n`)).toBe(true);
    });

    it('refuses a missing length, a header that never ends and a message past the cap', () => {
        expect(() => new ContentLengthDecoder().accept(new TextEncoder().encode('X-Other: 1\r\n\r\n{}'))).toThrow('Content-Length');
        expect(() => new ContentLengthDecoder().accept(new TextEncoder().encode('a'.repeat(9000)))).toThrow('too large');
        expect(() => new ContentLengthDecoder(10).accept(new TextEncoder().encode('Content-Length: 11\r\n\r\n'))).toThrow('too large');
    });
});

function fakeStream() {
    const dataListeners = new Set<(chunk: Uint8Array) => void>();
    const closeListeners = new Set<(error?: Error) => void>();
    const written: Uint8Array[] = [];
    let closed = false;
    const stream: ByteStream = {
        write: (chunk) => {
            written.push(chunk);
        },
        onData: (listener) => {
            dataListeners.add(listener);
            return { dispose: () => dataListeners.delete(listener) };
        },
        onClose: (listener) => {
            closeListeners.add(listener);
            return { dispose: () => closeListeners.delete(listener) };
        },
        close: () => {
            closed = true;
        }
    };
    return {
        stream,
        written,
        isClosed: () => closed,
        push: (chunk: Uint8Array) => dataListeners.forEach((listener) => listener(chunk)),
        end: (error?: Error) => closeListeners.forEach((listener) => listener(error))
    };
}

describe('stream transport', () => {
    it('frames what it sends and parses what arrives, holding a message that came before a listener', async () => {
        const fake = fakeStream();
        const transport = createStreamTransport(fake.stream);
        fake.push(encodeMessage(hello));
        const received: unknown[] = [];
        transport.onMessage((message) => received.push(message));
        expect(received).toEqual([hello]);
        await transport.send(hello);
        expect(fake.written[0]).toEqual(encodeMessage(hello));
    });

    it('closes with the error when the stream sends garbage, and when it ends', async () => {
        const fake = fakeStream();
        const transport = createStreamTransport(fake.stream);
        const closes: (Error | undefined)[] = [];
        transport.onClose((error) => closes.push(error));
        fake.push(new TextEncoder().encode('garbage\r\n\r\n'));
        expect(closes[0]?.message).toContain('Content-Length');
        expect(fake.isClosed()).toBe(true);
        await expect(Promise.resolve().then(() => transport.send(hello))).rejects.toThrow('closed');

        const ended = fakeStream();
        const second = createStreamTransport(ended.stream);
        const reasons: (Error | undefined)[] = [];
        second.onClose((error) => reasons.push(error));
        ended.end(new Error('exited 1'));
        expect(reasons[0]?.message).toBe('exited 1');
    });
});

describe('memory transport', () => {
    it('hands what one end sends to the other as a copy, and ends both together', async () => {
        const [client, server] = createMemoryTransportPair();
        const received: unknown[] = [];
        server.onMessage((message) => received.push(message));
        const closes: string[] = [];
        client.onClose(() => closes.push('client'));
        server.onClose(() => closes.push('server'));
        const message: RpcMessage = { jsonrpc: '2.0', method: 'x', params: { skipped: undefined, kept: 1 } };
        client.send(message);
        expect(received).toEqual([]);
        await Promise.resolve();
        expect(received).toEqual([{ jsonrpc: '2.0', method: 'x', params: { kept: 1 } }]);
        server.close();
        expect(closes.sort()).toEqual(['client', 'server']);
        expect(() => client.send(message)).toThrow('closed');
    });
});

class FakeSocket extends EventTarget {
    readyState = 0;
    bufferedAmount = 0;
    sent: string[] = [];
    closeCode: number | undefined;

    send(data: string): void {
        this.sent.push(data);
    }

    close(code?: number): void {
        this.closeCode = code;
        this.readyState = 3;
    }

    open(): void {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
    }

    receive(data: unknown): void {
        this.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
}

describe('WebSocket transport', () => {
    it('sends and receives JSON text frames once the socket is open', async () => {
        const socket = new FakeSocket();
        const connecting = connectWebSocket('ws://example.test', { createWebSocket: () => socket as unknown as WebSocket });
        socket.open();
        const transport = await connecting;
        const received: unknown[] = [];
        transport.onMessage((message) => received.push(message));
        socket.receive(JSON.stringify(hello));
        expect(received).toEqual([hello]);
        await transport.send(hello);
        expect(JSON.parse(socket.sent[0])).toEqual(hello);
        const closes: (Error | undefined)[] = [];
        transport.onClose((error) => closes.push(error));
        socket.receive(new Uint8Array(1));
        expect(closes[0]?.message).toContain('text frames');
        expect(socket.closeCode).toBe(1003);
    });

    it('fails when the socket closes before it opens or the signal aborts', async () => {
        const closing = new FakeSocket();
        const first = connectWebSocket('ws://example.test', { createWebSocket: () => closing as unknown as WebSocket });
        closing.dispatchEvent(new Event('close'));
        await expect(first).rejects.toThrow('before opening');
        const controller = new AbortController();
        controller.abort();
        await expect(connectWebSocket('ws://example.test', { signal: controller.signal })).rejects.toThrow('cancelled');
    });
});
