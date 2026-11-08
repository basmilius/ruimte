import { timingSafeEqual } from 'node:crypto';
import {
    ChunkedBody,
    forwardedHead,
    framingOf,
    headerValues,
    parseAbsoluteTarget,
    parseAuthority,
    parseRequestHead,
    statusOfResponse,
    MAX_HEAD_BYTES,
    type Authority,
    type RequestHead
} from './http-head';
import type { TunnelRelay, TunnelStream } from './relay';

export const PROXY_REALM = 'ruimte-port';
export const PROXY_USER = 'ruimte';

/* What the proxy needs of the socket of a page; a `net.Socket` fits it. */
export interface ProxySocket {
    write(bytes: Uint8Array, flushed?: () => void): boolean;
    pause(): void;
    resume(): void;
    end(): void;
    destroy(): void;
}

export interface ProxyConnectionOptions {
    socket: ProxySocket;
    relay: TunnelRelay;
    /* The only port the tunnel reaches; an authority with another is refused. */
    port: number;
    /* The secret of this tunnel, which every request must carry as the password of the proxy login. */
    secret: string;
    /* A request for something the tunnel does not reach, for the page to say so. */
    refused(authority: string): void;
}

type Mode = 'head' | 'length' | 'chunked' | 'upgrading' | 'tunnel' | 'closing';

const REASONS: Record<number, string> = {
    400: 'Bad Request',
    403: 'Forbidden',
    407: 'Proxy Authentication Required',
    431: 'Request Header Fields Too Large',
    501: 'Not Implemented',
    502: 'Bad Gateway'
};

function sameSecret(given: string | undefined, secret: string): boolean {
    if (given === undefined) {
        return false;
    }

    const expected = Buffer.from(`Basic ${Buffer.from(`${PROXY_USER}:${secret}`).toString('base64')}`);
    const actual = Buffer.from(given);

    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/*
 * One connection of a page to the proxy of a tunnel. Every request head is parsed, authenticated and checked
 * against the one port the tunnel reaches before a byte goes toward the machine, and rewritten from
 * absolute-form to origin-form without the headers of the proxy. Bodies pass by their framing. After a
 * CONNECT that was answered, or a WebSocket upgrade the service answered with 101, the rest is opaque.
 */
export class ProxyConnection {
    private readonly options: ProxyConnectionOptions;
    private mode: Mode = 'head';
    private input: Buffer = Buffer.alloc(0);
    private stream: TunnelStream | null = null;
    private opening = false;
    private blocked = false;
    private remaining = 0;
    private chunks = new ChunkedBody();
    private responseHead: Buffer = Buffer.alloc(0);
    private over = false;

    constructor(options: ProxyConnectionOptions) {
        this.options = options;
    }

    receive(chunk: Uint8Array): void {
        if (this.over || this.mode === 'closing') {
            return;
        }

        this.input = Buffer.concat([this.input, chunk]);
        this.run();
    }

    /* The page went away. */
    closed(): void {
        this.over = true;
        this.stream?.close();
        this.stream = null;
    }

    private run(): void {
        while (!this.over && !this.opening && this.input.length > 0) {
            switch (this.mode) {
                case 'head':
                    if (!this.readHead()) {
                        return;
                    }

                    break;
                case 'length': {
                    const take = Math.min(this.remaining, this.input.length);

                    this.forward(this.input.subarray(0, take));
                    this.input = this.input.subarray(take);
                    this.remaining -= take;
                    this.mode = this.remaining === 0 ? 'head' : 'length';
                    break;
                }
                case 'chunked': {
                    const used = this.chunks.feed(this.input);

                    if (this.chunks.error !== null) {
                        this.fail(400, this.chunks.error);

                        return;
                    }

                    this.forward(this.input.subarray(0, used));
                    this.input = this.input.subarray(used);
                    this.mode = this.chunks.done ? 'head' : 'chunked';
                    break;
                }
                case 'tunnel': {
                    this.forward(this.input);
                    this.input = Buffer.alloc(0);
                    break;
                }
                default:
                    // Waiting for the service to answer an upgrade: the page sends nothing before that.
                    this.options.socket.pause();

                    return;
            }
        }
    }

    /* False when the head is not complete yet or the request is being answered or opened. */
    private readHead(): boolean {
        const parsed = parseRequestHead(this.input);

        if (parsed.kind === 'need-more') {
            return false;
        }

        if (parsed.kind === 'bad') {
            this.fail(parsed.status, parsed.reason);

            return false;
        }

        this.input = parsed.rest;
        const { head } = parsed;

        if (!sameSecret(headerValues(head.headers, 'proxy-authorization')[0], this.options.secret)) {
            this.fail(407, 'This proxy belongs to one page of Ruimte', { 'Proxy-Authenticate': `Basic realm="${PROXY_REALM}"` });

            return false;
        }

        if (head.method === 'CONNECT') {
            return this.connect(head);
        }

        return this.request(head);
    }

    private connect(head: RequestHead): boolean {
        const authority = this.allowed(head.target);

        if (authority === null) {
            return false;
        }

        this.withStream(() => {
            this.options.socket.write(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'));
            this.mode = 'tunnel';
        });

        return false;
    }

    private request(head: RequestHead): boolean {
        const target = parseAbsoluteTarget(head.target);

        if (target === null) {
            if (/^https?:/i.test(head.target)) {
                // A page of another address, or another scheme: the tunnel reaches nothing but the one port.
                this.options.refused(head.target);
                this.fail(403, 'That address is not shared through this machine');
            } else {
                this.fail(400, 'A proxy request carries an absolute http address');
            }

            return false;
        }

        if (this.allowed(`${target.authority.text}`) === null) {
            return false;
        }

        const claimed = headerValues(head.headers, 'host');

        if (claimed.length > 1 || (claimed.length === 1 && claimed[0]!.toLowerCase() !== target.authority.text)) {
            this.fail(400, 'The Host header names another authority than the address');

            return false;
        }

        const framing = framingOf(head.headers);

        if (framing.kind === 'bad') {
            this.fail(400, framing.reason);

            return false;
        }

        const upgrade = headerValues(head.headers, 'upgrade').length > 0 && framing.kind === 'none';
        const bytes = forwardedHead(head, target.authority, target.path);

        this.withStream(() => {
            this.forward(bytes);

            if (upgrade) {
                this.mode = 'upgrading';
                this.responseHead = Buffer.alloc(0);
            } else if (framing.kind === 'length') {
                this.mode = 'length';
                this.remaining = framing.bytes;
            } else if (framing.kind === 'chunked') {
                this.mode = 'chunked';
                this.chunks = new ChunkedBody();
            }
        });

        return false;
    }

    /* Null after answering a refusal. */
    private allowed(text: string): Authority | null {
        const authority = parseAuthority(text);

        if (authority === null || authority.port !== this.options.port) {
            this.options.refused(text);
            this.fail(403, 'That address is not shared through this machine');

            return null;
        }

        return authority;
    }

    /* Runs `then` with the stream to the machine, opening it first when this connection has none. */
    private withStream(then: () => void): void {
        if (this.stream !== null) {
            then();
            this.run();

            return;
        }

        this.opening = true;
        this.options.socket.pause();
        this.options.relay
            .open({
                data: (bytes, consumed) => this.fromService(bytes, consumed),
                drain: () => {
                    this.blocked = false;
                    this.options.socket.resume();
                },
                end: (reason) => this.serviceEnded(reason)
            })
            .then(
                (stream) => {
                    this.opening = false;

                    if (this.over) {
                        stream.close();

                        return;
                    }

                    this.stream = stream;
                    this.options.socket.resume();
                    then();
                    this.run();
                },
                () => {
                    this.opening = false;
                    this.fail(502, 'The machine does not answer for this port');
                }
            );
    }

    private forward(bytes: Uint8Array): void {
        if (bytes.length === 0 || this.stream === null) {
            return;
        }

        if (!this.stream.write(bytes) && !this.blocked) {
            this.blocked = true;
            this.options.socket.pause();
        }
    }

    private fromService(bytes: Uint8Array, consumed: () => void): void {
        if (this.over) {
            consumed();

            return;
        }

        if (this.mode === 'upgrading') {
            this.responseHead = Buffer.concat([this.responseHead, bytes]);

            const done = this.responseHead.includes('\r\n\r\n') || this.responseHead.length >= MAX_HEAD_BYTES;

            if (!done) {
                consumed();

                return;
            }

            // Only a service that agreed to the upgrade gets an opaque connection; any other answer is read once and ends this connection.
            const accepted = statusOfResponse(this.responseHead) === 101;
            const held = this.responseHead;

            this.responseHead = Buffer.alloc(0);
            this.mode = accepted ? 'tunnel' : 'closing';
            this.options.socket.write(held, consumed);
            this.options.socket.resume();
            this.run();

            return;
        }

        this.options.socket.write(bytes, consumed);
    }

    private serviceEnded(reason: string | null): void {
        this.stream = null;

        if (this.over) {
            return;
        }

        this.over = true;

        if (reason === null) {
            this.options.socket.end();
        } else {
            this.options.socket.destroy();
        }
    }

    /* Answers a request the proxy will not pass on and ends the connection: nothing after it can be trusted to line up. */
    private fail(status: number, text: string, headers: Record<string, string> = {}): void {
        if (this.over) {
            return;
        }

        this.over = true;
        this.stream?.close();
        this.stream = null;

        const body = `${text}\n`;
        const lines = [
            `HTTP/1.1 ${status} ${REASONS[status] ?? 'Error'}`,
            'Content-Type: text/plain; charset=utf-8',
            `Content-Length: ${Buffer.byteLength(body)}`,
            'Connection: close',
            ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)
        ];

        this.options.socket.write(Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`));
        this.options.socket.end();
    }
}
