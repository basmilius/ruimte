import type { Socket } from 'bun';
import { join } from 'node:path';
import { realShell } from './shell-editor-test-helpers.ts';

/* A relay on the editor socket that holds back the prepare frame after the real daemon dispatched it. */
export async function relayedShell() {
    let downstream: Socket<undefined> | undefined;
    let upstream: Socket<undefined> | undefined;
    let queued: Uint8Array[] = [];
    let held = '';
    let buffer = '';
    const decoder = new TextDecoder();
    let server: ReturnType<typeof Bun.listen<undefined>> | undefined;
    const fixture = await realShell((home) => {
        server = Bun.listen<undefined>({
            unix: join(home, 'proxy.sock'),
            socket: {
                open(socket) {
                    downstream = socket;
                },
                data(_socket, bytes) {
                    if (upstream) {
                        upstream.write(bytes);
                    } else {
                        queued.push(bytes.slice());
                    }
                },
                close() {},
                error() {}
            }
        });
        return `PS1='relay> '\n_ruimte_editor_path='${home}/proxy.sock'\n`;
    });
    upstream = await Bun.connect<undefined>({
        unix: fixture.editorAddress,
        socket: {
            open(socket) {
                upstream = socket;
                for (const bytes of queued) {
                    socket.write(bytes);
                }
                queued = [];
            },
            data(_socket, bytes) {
                buffer += decoder.decode(bytes, { stream: true });
                let end: number;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    const frame = buffer.slice(0, end + 1);
                    buffer = buffer.slice(end + 1);
                    if (frame.split('\t')[1] === 'prepare') {
                        held = frame;
                    } else {
                        downstream?.write(frame);
                    }
                }
            },
            close() {},
            error() {}
        }
    });
    return {
        ...fixture,
        hasHeld: () => held !== '',
        forward() {
            downstream?.write(held);
            held = '';
        },
        async cleanup() {
            upstream?.terminate();
            downstream?.terminate();
            server?.stop(true);
            await fixture.cleanup();
        }
    };
}
