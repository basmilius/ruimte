import { createConnection } from 'node:net';
import { PORT_ANSWER_MS } from '@ruimte/contracts';
import type { PortConnect, PortSocket } from './port-streams.ts';

/*
 * A real connection to the literal loopback address of a grant. The address is never looked up: `host` is
 * `127.0.0.1` or `::1` and a failed attempt does not try the other family.
 */
export const connectLoopback: PortConnect = (host, port, handlers) =>
    new Promise<PortSocket>((resolve, reject) => {
        const socket = createConnection({ host, port, allowHalfOpen: true, family: host === '::1' ? 6 : 4 });
        let opened = false;
        let over = false;

        const stop = setTimeout(() => {
            socket.destroy(new Error('it did not answer in time'));
        }, PORT_ANSWER_MS);

        const portSocket: PortSocket = {
            write: (bytes) =>
                new Promise<void>((done, fail) => {
                    if (socket.destroyed || !socket.writable) {
                        fail(new Error('the connection is closed'));

                        return;
                    }

                    // The callback fires once the bytes left Node's buffer, which is the acknowledgement the client's window waits for.
                    socket.write(bytes, (error) => (error ? fail(error) : done()));
                }),
            shutdownWrite: () => {
                if (!socket.destroyed) {
                    socket.end();
                }
            },
            close: () => {
                socket.destroy();
            },
            pause: () => {
                socket.pause();
            },
            resume: () => {
                socket.resume();
            }
        };

        socket.once('connect', () => {
            opened = true;
            clearTimeout(stop);
            resolve(portSocket);
        });
        socket.on('data', (chunk: Buffer) => {
            // Copied, since Node may reuse the memory behind a chunk.
            handlers.data(new Uint8Array(chunk));
        });
        socket.on('end', () => {
            if (!over) {
                over = true;
                handlers.ended(null);
            }
        });
        socket.on('error', (error) => {
            clearTimeout(stop);

            if (!opened) {
                reject(error);

                return;
            }

            if (!over) {
                over = true;
                handlers.ended(error.message);
            }
        });
        socket.on('close', () => {
            clearTimeout(stop);

            if (opened && !over) {
                over = true;
                handlers.ended(null);
            }
        });
    });
