import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { ProxyConnection } from './proxy-connection';
import type { TunnelRelay } from './relay';

/* A page opens a handful of connections; more than this is not a page. */
const MAX_CONNECTIONS = 64;

/* A connection that has not sent a whole request head with the secret by then is not a browser, however slowly it writes. */
const HEAD_TIMEOUT_MS = 10_000;

interface ProxyListenerOptions {
    relay: TunnelRelay;
    port: number;
    refused(authority: string): void;
}

export interface ProxyListener {
    readonly port: number;
    /* The password of the proxy login, which only the shell's login handler for this tunnel's session ever answers with. */
    readonly secret: string;
    stop(): void;
}

/*
 * The proxy of one tunnel, on 127.0.0.1 and a port the system chose. A listener is a capability of its own, so
 * a port nobody guesses is no protection: every request must carry the secret, and a process that connects
 * without it learns nothing and opens no stream.
 */
export async function startProxyListener(options: ProxyListenerOptions): Promise<ProxyListener> {
    const secret = randomBytes(24).toString('base64url');
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
        if (sockets.size >= MAX_CONNECTIONS) {
            socket.destroy();

            return;
        }

        sockets.add(socket);
        socket.setNoDelay(true);

        const connection = new ProxyConnection({
            socket: {
                write: (bytes, flushed) => socket.write(bytes, flushed === undefined ? undefined : () => flushed()),
                pause: () => {
                    socket.pause();
                },
                resume: () => {
                    socket.resume();
                },
                end: () => {
                    socket.end();
                },
                destroy: () => {
                    socket.destroy();
                }
            },
            relay: options.relay,
            port: options.port,
            secret,
            refused: options.refused,
            headTimeoutMs: HEAD_TIMEOUT_MS
        });

        socket.on('data', (chunk: Buffer) => connection.receive(chunk));
        socket.on('error', () => socket.destroy());
        socket.on('close', () => {
            sockets.delete(socket);
            connection.closed();
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0 }, () => resolve());
    });

    const address = server.address();

    if (address === null || typeof address === 'string') {
        server.close();
        throw new Error('The proxy of a shared port has no address');
    }

    return {
        port: address.port,
        secret,
        stop() {
            server.close();

            for (const socket of sockets) {
                socket.destroy();
            }
        }
    };
}
