import { lookup } from 'node:dns/promises';
import { connect, createServer, isIP, type Socket } from 'node:net';
import { isLocalAddress } from './local-address.ts';

/*
 * A SOCKS5 proxy (RFC 1928) on loopback that carries a visual's browser to public addresses only:
 * CONNECT, no authentication, nothing else. It resolves a name itself, refuses it when any address
 * the name has is local, and connects only to the addresses it checked, so a name that answers
 * differently a moment later changes nothing.
 */

export const SOCKS_REPLY = {
    succeeded: 0x00,
    generalFailure: 0x01,
    notAllowed: 0x02,
    hostUnreachable: 0x04,
    connectionRefused: 0x05,
    commandNotSupported: 0x07,
    addressNotSupported: 0x08
} as const;

const VERSION = 5;
const NO_AUTHENTICATION = 0x00;
const NO_ACCEPTABLE_METHOD = 0xff;
const CONNECT = 0x01;
const CONNECT_TIMEOUT_MS = 10_000;
// A greeting and a request together are under 300 bytes; anything longer is not a client of this proxy.
const MAX_HANDSHAKE_BYTES = 1024;

/* `more` until enough bytes arrived; `bad` with the reply to send before closing, or null to close without one. */
export type SocksParse<T> = { status: 'more' } | { status: 'bad'; reply: number | null } | { status: 'done'; value: T; length: number };

export interface SocksRequest {
    type: 'ipv4' | 'ipv6' | 'domain';
    host: string;
    port: number;
}

/* The client's greeting and whether it offers to go without authentication, the only method this proxy speaks. */
export function parseGreeting(bytes: Uint8Array): SocksParse<{ noAuthentication: boolean }> {
    if (bytes.length >= 1 && bytes[0] !== VERSION) {
        return { status: 'bad', reply: null };
    }
    if (bytes.length < 2 || bytes.length < 2 + bytes[1]!) {
        return { status: 'more' };
    }
    const methods = bytes.subarray(2, 2 + bytes[1]!);
    return { status: 'done', value: { noAuthentication: methods.includes(NO_AUTHENTICATION) }, length: 2 + methods.length };
}

export function greetingReply(noAuthentication: boolean): Uint8Array {
    return Uint8Array.of(VERSION, noAuthentication ? NO_AUTHENTICATION : NO_ACCEPTABLE_METHOD);
}

function portAt(bytes: Uint8Array, at: number): number {
    return (bytes[at]! << 8) | bytes[at + 1]!;
}

/* A CONNECT request; any other command is refused once its header is in. */
export function parseRequest(bytes: Uint8Array): SocksParse<SocksRequest> {
    if (bytes.length >= 1 && bytes[0] !== VERSION) {
        return { status: 'bad', reply: null };
    }
    if (bytes.length < 4) {
        return { status: 'more' };
    }
    if (bytes[1] !== CONNECT) {
        return { status: 'bad', reply: SOCKS_REPLY.commandNotSupported };
    }
    const type = bytes[3];
    if (type === 0x01) {
        if (bytes.length < 10) {
            return { status: 'more' };
        }
        return { status: 'done', value: { type: 'ipv4', host: [...bytes.subarray(4, 8)].join('.'), port: portAt(bytes, 8) }, length: 10 };
    }
    if (type === 0x04) {
        if (bytes.length < 22) {
            return { status: 'more' };
        }
        const groups: string[] = [];
        for (let i = 4; i < 20; i += 2) {
            groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));
        }
        return { status: 'done', value: { type: 'ipv6', host: groups.join(':'), port: portAt(bytes, 20) }, length: 22 };
    }
    if (type === 0x03) {
        if (bytes.length < 5) {
            return { status: 'more' };
        }
        const size = bytes[4]!;
        if (size === 0) {
            return { status: 'bad', reply: SOCKS_REPLY.generalFailure };
        }
        if (bytes.length < 5 + size + 2) {
            return { status: 'more' };
        }
        const host = new TextDecoder('latin1').decode(bytes.subarray(5, 5 + size));
        return { status: 'done', value: { type: 'domain', host, port: portAt(bytes, 5 + size) }, length: 5 + size + 2 };
    }
    return { status: 'bad', reply: SOCKS_REPLY.addressNotSupported };
}

/* A reply that names no bound address, which a CONNECT client has no use for. */
export function socksReply(code: number): Uint8Array {
    return Uint8Array.of(VERSION, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0);
}

export interface SocksDeps {
    resolve(host: string): Promise<string[]>;
    isLocal(address: string): boolean;
}

export const SYSTEM_SOCKS_DEPS: SocksDeps = {
    resolve: async (host) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address),
    isLocal: (address) => isLocalAddress(address)
};

/* The addresses a request may be connected to, or the reply that refuses it. */
export async function permittedAddresses(request: SocksRequest, deps: SocksDeps): Promise<{ addresses: string[] } | { reply: number }> {
    if (request.port === 0) {
        return { reply: SOCKS_REPLY.notAllowed };
    }
    let addresses: string[];
    if (request.type !== 'domain' || isIP(request.host) !== 0) {
        addresses = [request.host];
    } else {
        try {
            addresses = await deps.resolve(request.host);
        } catch {
            return { reply: SOCKS_REPLY.hostUnreachable };
        }
    }
    if (addresses.length === 0) {
        return { reply: SOCKS_REPLY.hostUnreachable };
    }
    if (addresses.some((address) => deps.isLocal(address))) {
        return { reply: SOCKS_REPLY.notAllowed };
    }
    return { addresses };
}

function connectTo(address: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = connect({ host: address, port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('timed out'));
        }, CONNECT_TIMEOUT_MS);
        const failed = (error: Error): void => {
            clearTimeout(timer);
            reject(error);
        };
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.removeListener('error', failed);
            resolve(socket);
        });
        socket.once('error', failed);
    });
}

/* The first of the checked addresses that takes the connection, in the order the resolver gave them. */
async function connectFirst(addresses: readonly string[], port: number): Promise<Socket | null> {
    for (const address of addresses) {
        try {
            return await connectTo(address, port);
        } catch {
            // The next address of the same name may still answer.
        }
    }
    return null;
}

export interface SocksProxy {
    port: number;
    close(): void;
}

/*
 * Listens on a free loopback port. `refused` hears every request turned down for where it leads, so
 * the page can be told why a resource did not load.
 */
export function startSocksProxy(deps: SocksDeps = SYSTEM_SOCKS_DEPS, refused: (request: SocksRequest) => void = () => undefined): Promise<SocksProxy> {
    const open = new Set<Socket>();
    const track = (socket: Socket): void => {
        open.add(socket);
        socket.once('close', () => open.delete(socket));
    };

    const serve = (client: Socket): void => {
        track(client);
        let buffered = new Uint8Array(0);
        let stage: 'greeting' | 'request' | 'waiting' = 'greeting';
        const fail = (reply: number | null): void => {
            stage = 'waiting';
            client.removeListener('data', receive);
            if (reply === null) {
                client.destroy();
            } else {
                client.end(socksReply(reply));
            }
        };
        const receive = (chunk: Uint8Array): void => {
            const joined = new Uint8Array(buffered.length + chunk.length);
            joined.set(buffered);
            joined.set(chunk, buffered.length);
            buffered = joined;
            if (buffered.length > MAX_HANDSHAKE_BYTES) {
                fail(null);
                return;
            }
            if (stage === 'greeting') {
                const greeting = parseGreeting(buffered);
                if (greeting.status === 'more') {
                    return;
                }
                if (greeting.status === 'bad') {
                    fail(null);
                    return;
                }
                if (!greeting.value.noAuthentication) {
                    stage = 'waiting';
                    client.removeListener('data', receive);
                    client.end(greetingReply(false));
                    return;
                }
                client.write(greetingReply(true));
                buffered = buffered.subarray(greeting.length);
                stage = 'request';
            }
            if (stage !== 'request' || buffered.length === 0) {
                return;
            }
            const request = parseRequest(buffered);
            if (request.status === 'more') {
                return;
            }
            if (request.status === 'bad') {
                fail(request.reply);
                return;
            }
            stage = 'waiting';
            client.removeListener('data', receive);
            client.pause();
            const rest = buffered.subarray(request.length);
            void forward(client, request.value, rest);
        };
        client.on('data', receive);
        client.on('error', () => client.destroy());
    };

    const forward = async (client: Socket, request: SocksRequest, rest: Uint8Array): Promise<void> => {
        const permitted = await permittedAddresses(request, deps);
        if ('reply' in permitted) {
            if (permitted.reply === SOCKS_REPLY.notAllowed) {
                refused(request);
            }
            client.end(socksReply(permitted.reply));
            return;
        }
        const upstream = await connectFirst(permitted.addresses, request.port);
        if (upstream === null) {
            client.end(socksReply(SOCKS_REPLY.connectionRefused));
            return;
        }
        if (client.destroyed) {
            upstream.destroy();
            return;
        }
        track(upstream);
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
        upstream.once('close', () => client.destroy());
        client.once('close', () => upstream.destroy());
        client.write(socksReply(SOCKS_REPLY.succeeded));
        if (rest.length > 0) {
            upstream.write(rest);
        }
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
    };

    const server = createServer(serve);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                reject(new Error('The proxy has no port'));
                return;
            }
            resolve({
                port: address.port,
                close: () => {
                    server.close();
                    for (const socket of open) {
                        socket.destroy();
                    }
                }
            });
        });
    });
}
