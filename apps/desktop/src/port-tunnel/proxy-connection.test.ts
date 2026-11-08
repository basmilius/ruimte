import { beforeEach, describe, expect, test } from 'bun:test';
import { ProxyConnection, PROXY_USER, type ProxySocket } from './proxy-connection';
import type { TunnelRelay, TunnelStream, TunnelStreamEvents } from './relay';

const SECRET = 'unique-secret-marker';
const LOGIN = `Proxy-Authorization: Basic ${Buffer.from(`${PROXY_USER}:${SECRET}`).toString('base64')}\r\n`;

class FakeSocket implements ProxySocket {
    readonly written: Buffer[] = [];
    paused = false;
    ended = false;
    destroyed = false;
    readonly flushes: Array<() => void> = [];

    write(bytes: Uint8Array, flushed?: () => void): boolean {
        this.written.push(Buffer.from(bytes));

        if (flushed !== undefined) {
            this.flushes.push(flushed);
        }

        return true;
    }

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        this.paused = false;
    }

    end(): void {
        this.ended = true;
    }

    destroy(): void {
        this.destroyed = true;
    }

    get text(): string {
        return Buffer.concat(this.written).toString('latin1');
    }
}

class FakeStream implements TunnelStream {
    readonly written: Buffer[] = [];
    full = false;
    writeClosed = false;
    closed = false;
    readonly events: TunnelStreamEvents;

    constructor(events: TunnelStreamEvents) {
        this.events = events;
    }

    write(bytes: Uint8Array): boolean {
        this.written.push(Buffer.from(bytes));

        return !this.full;
    }

    closeWrite(): void {
        this.writeClosed = true;
    }

    close(): void {
        this.closed = true;
    }

    get text(): string {
        return Buffer.concat(this.written).toString('latin1');
    }
}

class FakeRelay implements TunnelRelay {
    readonly streams: FakeStream[] = [];
    failing = false;

    async open(events: TunnelStreamEvents): Promise<TunnelStream> {
        if (this.failing) {
            throw new Error('no');
        }

        const stream = new FakeStream(events);
        this.streams.push(stream);

        return stream;
    }
}

let socket: FakeSocket;
let relay: FakeRelay;
let refused: string[];
let connection: ProxyConnection;

beforeEach(() => {
    socket = new FakeSocket();
    relay = new FakeRelay();
    refused = [];
    connection = new ProxyConnection({ socket, relay, port: 3000, secret: SECRET, refused: (authority) => refused.push(authority) });
});

function send(text: string): void {
    connection.receive(Buffer.from(text, 'latin1'));
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function get(target: string, headers = ''): string {
    return `GET ${target} HTTP/1.1\r\n${LOGIN}Proxy-Connection: keep-alive\r\nAccept: */*\r\n${headers}\r\n`;
}

describe('the proxy login', () => {
    test('asks for credentials when there are none and opens no stream', async () => {
        send('GET http://localhost:3000/ HTTP/1.1\r\nHost: localhost:3000\r\n\r\n');
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 407');
        expect(socket.text).toContain('Proxy-Authenticate: Basic realm="ruimte-port"');
        expect(socket.ended).toBe(true);
        expect(relay.streams).toEqual([]);
    });

    test('refuses a wrong secret the same way', async () => {
        send(`GET http://localhost:3000/ HTTP/1.1\r\nProxy-Authorization: Basic ${Buffer.from('ruimte:other').toString('base64')}\r\n\r\n`);
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 407');
        expect(relay.streams).toEqual([]);
    });
});

describe('a request', () => {
    test('goes to the machine in origin-form with the headers of the proxy gone', async () => {
        send(get('http://localhost:3000/app?x=1', 'Authorization: Bearer site-token\r\nCookie: a=b\r\n').replace('\r\n\r\n', '\r\n\r\n'));
        await settle();

        const forwarded = relay.streams[0]!.text;

        expect(forwarded).toStartWith('GET /app?x=1 HTTP/1.1\r\nHost: localhost:3000\r\n');
        expect(forwarded).toContain('Accept: */*');
        expect(forwarded).toContain('Authorization: Bearer site-token');
        expect(forwarded).toContain('Cookie: a=b');
        expect(forwarded).not.toContain('Proxy-');
        expect(forwarded).not.toContain(SECRET);
        expect(forwarded).not.toContain(Buffer.from(`${PROXY_USER}:${SECRET}`).toString('base64'));
    });

    test('reaches an IPv6 spelling and a missing path', async () => {
        const v6 = new ProxyConnection({ socket, relay, port: 80, secret: SECRET, refused: () => undefined });

        v6.receive(Buffer.from(get('http://[::1]/')));
        await settle();

        expect(relay.streams[0]!.text).toStartWith('GET / HTTP/1.1\r\nHost: [::1]\r\n');
    });

    test('refuses another port, another host and another scheme without a stream', async () => {
        for (const target of ['http://localhost:3001/', 'http://example.com:3000/', 'http://127.1:3000/', 'http://localhost:3000@evil.test/', 'https://localhost:3000/']) {
            socket = new FakeSocket();
            connection = new ProxyConnection({ socket, relay, port: 3000, secret: SECRET, refused: (authority) => refused.push(authority) });
            send(get(target));
            await settle();

            expect(socket.text).toStartWith('HTTP/1.1 403');
        }

        expect(relay.streams).toEqual([]);
        expect(refused).toHaveLength(5);
    });

    test('refuses a Host header that names another authority than the address', async () => {
        send(get('http://localhost:3000/', 'Host: localhost:9999\r\n'));
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 400');
        expect(relay.streams).toEqual([]);
    });

    test('refuses a request that names a length and chunks, and a header with a space before the colon', async () => {
        send(get('http://localhost:3000/', 'Content-Length: 4\r\nTransfer-Encoding: chunked\r\n'));
        await settle();
        expect(socket.text).toStartWith('HTTP/1.1 400');

        socket = new FakeSocket();
        connection = new ProxyConnection({ socket, relay, port: 3000, secret: SECRET, refused: () => undefined });
        send(get('http://localhost:3000/', 'Content-Length : 4\r\n'));
        await settle();
        expect(socket.text).toStartWith('HTTP/1.1 400');
        expect(relay.streams).toEqual([]);
    });

    test('refuses a request that is not in absolute-form', async () => {
        send(get('/index.html'));
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 400');
    });

    test('passes a body by its length and checks the next request on the same connection', async () => {
        send(get('http://localhost:3000/upload', 'Content-Length: 5\r\n').replace('GET', 'POST') + 'hel');
        await settle();
        send('lo');
        send(get('http://localhost:3000/next'));
        await settle();

        const forwarded = relay.streams[0]!.text;

        expect(forwarded).toContain('POST /upload HTTP/1.1');
        expect(forwarded).toContain('\r\n\r\nhello');
        expect(forwarded).toContain('GET /next HTTP/1.1');
        expect(relay.streams).toHaveLength(1);
    });

    test('stops a pipelined request for another port after the first went through', async () => {
        send(get('http://localhost:3000/one') + get('http://localhost:4000/two'));
        await settle();

        expect(relay.streams[0]!.text).toContain('GET /one');
        expect(relay.streams[0]!.text).not.toContain('/two');
        expect(socket.text).toContain('HTTP/1.1 403');
        expect(relay.streams[0]!.closed).toBe(true);
    });

    test('follows a chunked body to its last chunk and trailers before it reads the next head', async () => {
        const request = get('http://localhost:3000/c', 'Transfer-Encoding: chunked\r\n').replace('GET', 'POST');

        send(request + '4\r\nwiki\r\n0\r\nX-Sum: 1\r\n\r\n' + get('http://localhost:3000/after'));
        await settle();

        expect(relay.streams[0]!.text).toContain('4\r\nwiki\r\n0\r\nX-Sum: 1\r\n\r\nGET /after');
    });

    test('ends a chunked body that lies about its framing', async () => {
        const request = get('http://localhost:3000/c', 'Transfer-Encoding: chunked\r\n').replace('GET', 'POST');

        send(request + '4\r\nwikiXX');
        await settle();

        expect(socket.text).toContain('HTTP/1.1 400');
    });

    test('answers 502 when the machine does not open the stream', async () => {
        relay.failing = true;
        send(get('http://localhost:3000/'));
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 502');
    });

    test('pauses the page while the machine holds too much and goes on at the drain', async () => {
        send(get('http://localhost:3000/', 'Content-Length: 4\r\n').replace('GET', 'POST'));
        await settle();
        relay.streams[0]!.full = true;
        send('abcd');

        expect(socket.paused).toBe(true);

        relay.streams[0]!.events.drain();

        expect(socket.paused).toBe(false);
    });
});

describe('the answer', () => {
    test('goes back to the page and frees the machine once it was written', async () => {
        send(get('http://localhost:3000/'));
        await settle();

        let consumed = 0;

        relay.streams[0]!.events.data(Buffer.from('HTTP/1.1 200 OK\r\n\r\nok'), () => (consumed += 1));

        expect(socket.text).toBe('HTTP/1.1 200 OK\r\n\r\nok');
        expect(consumed).toBe(0);

        socket.flushes[0]!();

        expect(consumed).toBe(1);
    });

    test('ends the page when the service ends', async () => {
        send(get('http://localhost:3000/'));
        await settle();
        relay.streams[0]!.events.end(null);

        expect(socket.ended).toBe(true);
    });

    test('closes the stream when the page goes', async () => {
        send(get('http://localhost:3000/'));
        await settle();
        connection.closed();

        expect(relay.streams[0]!.closed).toBe(true);
    });
});

describe('CONNECT and upgrades', () => {
    test('answers a CONNECT to the shared port and then carries bytes unread', async () => {
        send(`CONNECT localhost:3000 HTTP/1.1\r\nHost: localhost:3000\r\n${LOGIN}\r\n`);
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 200 Connection Established');
        expect(relay.streams[0]!.text).toBe('');

        send('GET /ws HTTP/1.1\r\nUpgrade: websocket\r\n\r\n');

        expect(relay.streams[0]!.text).toBe('GET /ws HTTP/1.1\r\nUpgrade: websocket\r\n\r\n');
    });

    test('refuses a CONNECT to any other authority', async () => {
        send(`CONNECT localhost:3001 HTTP/1.1\r\n${LOGIN}\r\n`);
        await settle();

        expect(socket.text).toStartWith('HTTP/1.1 403');
        expect(relay.streams).toEqual([]);
    });

    test('goes opaque for a WebSocket only after the service answered 101', async () => {
        send(get('http://localhost:3000/socket', 'Connection: Upgrade\r\nUpgrade: websocket\r\n'));
        await settle();
        relay.streams[0]!.events.data(Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n'), () => undefined);
        send('frame-bytes');

        expect(socket.text).toStartWith('HTTP/1.1 101');
        expect(relay.streams[0]!.text).toEndWith('frame-bytes');
    });

    test('reads a refused upgrade as one answer and sends nothing more to the service', async () => {
        send(get('http://localhost:3000/socket', 'Connection: Upgrade\r\nUpgrade: websocket\r\n'));
        await settle();
        relay.streams[0]!.events.data(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nno'), () => undefined);

        const before = relay.streams[0]!.text;

        send(get('http://localhost:4000/sneaky'));

        expect(relay.streams[0]!.text).toBe(before);
        expect(socket.text).toContain('HTTP/1.1 200 OK');
    });
});

test('the secret never reaches the machine in any exchange', async () => {
    send(get('http://localhost:3000/a'));
    send(get('http://localhost:3000/b', 'Content-Length: 3\r\n').replace('GET', 'POST') + 'abc');
    await settle();

    expect(relay.streams[0]!.text).not.toContain(SECRET);
    expect(relay.streams[0]!.text).not.toContain('Proxy-Authorization');
});
